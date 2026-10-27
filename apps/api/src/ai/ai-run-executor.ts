import { Injectable, Logger } from "@nestjs/common";
import type { AiOutputMode, AiWorkflowRun, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiSettingsService } from "./ai-settings.service";
import { settingChanged } from "./ai-snapshot";
import { guidanceForStep, type GuidanceSnapshot, type RunStepName } from "./guidance/guidance-snapshot";
import { renderTeamGuidance } from "./guidance/resolve-guidance";
import { AiProviderError, scrubProviderError } from "./provider-error";
import { modeFor, type Repair } from "./providers/output-mode";
import { createAiProvider, type AiProvider } from "./providers/provider";
import { coverageAuditor, sanitizeAudit } from "./skills/coverage-auditor";
import { requirementReviewer } from "./skills/requirement-reviewer";
import type { AiSkill } from "./skills/skill";
import { testDesigner, testReviser } from "./skills/test-designer";
import type { Audit, CaseDraft, Review, RunContext } from "./skills/types";
import { stripBounds } from "./validate-output";

/** How long a claim on a run holds, unless a step needs longer (see extendLock). */
export const RUN_LOCK_MS = 5 * 60 * 1000;
/** A step is tried at most three times: when an answer is unusable it is asked for again, saying what was wrong. */
const MAX_ATTEMPTS_PER_STEP = 3;
/** Every model call of a run, retries included. A revision makes exactly five when every answer is usable at once. */
const MAX_MODEL_CALLS = 10;
/** The error of a step that was in flight when the process died: nothing is known about how it would have ended. */
const INTERRUPTED = "Interrupted by a restart";
/** Other cases of the project that are sent for duplicate detection. */
const OTHER_CASES_SENT = 200;

/** The run was cancelled (or ended some other way) while a step was under way: stop, and leave it as it is. */
class RunStopped extends Error {}
/** The run cannot go on; the message is shown to people. */
class RunFailure extends Error {}

/** What a model call needs besides the prompt: who to call, how to ask, and what the setting has learned about it. */
interface ProviderHandle {
  provider: AiProvider;
  timeoutMs: number;
  credential: string | null;
  settingsId: string;
  /** Anthropic always answers through a forced tool: there is no other way to ask for it. */
  anthropic: boolean;
  outputMode: AiOutputMode;
  learnedMode: AiOutputMode | null;
}

type StepName = RunStepName;

/**
 * Carries one claimed run to its next resting place: waiting for approval, failed, or stopped by a cancel. The
 * steps are saved as they finish, so a run that was taken over after a crash resumes at the first step without
 * an answer. Nothing here writes to cases; that happens only when a person approves the drafts.
 */
@Injectable()
export class AiRunExecutor {
  private readonly logger = new Logger(AiRunExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Never throws: whatever goes wrong ends the run as failed, or is logged. */
  async execute(runId: string): Promise<void> {
    const run = await this.prisma.aiWorkflowRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "RUNNING") return;
    // Known once the setting is read, so an error message can be scrubbed of it.
    let credential: string | null = null;
    try {
      await this.runWorkflow(run, (value) => {
        credential = value;
      });
    } catch (error) {
      if (error instanceof RunStopped) return;
      const message =
        error instanceof RunFailure || error instanceof AiProviderError
          ? error.message
          : "The run failed unexpectedly";
      if (!(error instanceof RunFailure || error instanceof AiProviderError)) {
        this.logger.error(`AI run ${runId} failed unexpectedly: ${error instanceof Error ? error.stack : String(error)}`);
      }
      await this.fail(run, scrubProviderError(message, credential));
    }
  }

  private async runWorkflow(run: AiWorkflowRun, rememberCredential: (value: string | null) => void): Promise<void> {
    // A step still marked as running was in flight when the process died; it has no answer.
    await this.prisma.aiWorkflowStep.updateMany({
      where: { runId: run.id, status: "RUNNING" },
      data: { status: "FAILED", error: INTERRUPTED, endedAt: new Date() },
    });

    // The setting is read again before every model call (see currentProvider), not once per claim: AI can be
    // switched off, removed or pointed elsewhere while a run waits or works, and the run must not go on sending.
    const getProvider = () => this.currentProvider(run, rememberCredential);
    const context = await this.loadContext(run);
    // The guidance the run was started with, text included: never the live guidance, which may have changed since.
    const guidance = run.guidance as unknown as GuidanceSnapshot | null;
    const step = <I, O>(name: StepName, skill: AiSkill<I, O>, input: I) =>
      this.runStep(run.id, getProvider, name, skill, input, guidanceForStep(guidance, name));

    const review: Review = await step("REVIEW", requirementReviewer, context);
    const design = await step("DESIGN", testDesigner, { context, review });
    let drafts: CaseDraft[] = design.cases;
    // How many drafts the model wrote beyond the limit (see toDrafts); of the revision when there is one.
    let omittedDrafts = design.omitted ?? 0;
    let audit: Audit = await step("AUDIT", coverageAuditor, { context, review, drafts });
    if (audit.revisionNeeded) {
      // One revision, then one more audit; whatever that audit finds is shown, not acted on.
      const revised = await step("REVISE", testReviser, { context, review, previous: drafts, audit });
      drafts = revised.cases;
      omittedDrafts = revised.omitted ?? 0;
      audit = await step("AUDIT_REVISED", coverageAuditor, { context, review, drafts });
    }
    audit = sanitizeAudit(audit, review.acceptanceCriteria.length, drafts.length, new Set(context.otherCases.map((c) => c.id)));

    // Only while the run is still ours: a cancel that came in meanwhile stays a cancel.
    await this.prisma.aiWorkflowRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: {
        status: "AWAITING_APPROVAL",
        result: { review, drafts, audit, ...(omittedDrafts > 0 ? { omittedDrafts } : {}) } as unknown as Prisma.InputJsonValue,
        lockedUntil: null,
      },
    });
  }

  /**
   * The provider for the next model call, from the setting the project uses right now. The run fails here when
   * that setting is gone or switched off, or is no longer the one the run was started with.
   */
  private async currentProvider(
    run: AiWorkflowRun,
    rememberCredential: (value: string | null) => void,
  ): Promise<ProviderHandle> {
    const { settings } = await this.settings.resolve(run.projectId);
    if (!settings || !settings.enabled) throw new RunFailure("AI is not enabled for this project");
    if (settingChanged(run.providerSnapshot, settings)) {
      throw new RunFailure("The AI setting changed while the run was waiting or in progress; start it again");
    }
    let credential: string | null = null;
    if (settings.credentialCipher) {
      credential = this.settings.openCredential(settings);
      rememberCredential(credential);
      if (credential === null) {
        throw new RunFailure("The saved provider key can't be read, probably because AI_ENCRYPTION_KEY changed");
      }
    }
    return {
      provider: createAiProvider({
        provider: settings.provider,
        model: settings.model,
        endpoint: settings.endpoint,
        credential,
        maxOutputTokens: settings.maxOutputTokens,
        requestTimeoutMs: settings.requestTimeoutMs,
      }),
      timeoutMs: settings.requestTimeoutMs,
      credential,
      settingsId: settings.id,
      anthropic: settings.provider === "ANTHROPIC",
      outputMode: settings.outputMode,
      learnedMode: settings.learnedMode,
    };
  }

  /** What the run may tell the provider about the project: the requirement, what is linked to it, other case titles. */
  private async loadContext(run: AiWorkflowRun): Promise<RunContext> {
    const input = run.input as { requirementId?: string; extraContext?: string | null };
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: input.requirementId ?? "" },
      include: {
        cases: {
          include: { testCase: { include: { steps: { orderBy: { position: "asc" } } } } },
        },
      },
    });
    if (!requirement || requirement.projectId !== run.projectId || requirement.archivedAt) {
      throw new RunFailure("The requirement is no longer available");
    }
    const linked = requirement.cases.map((link) => link.testCase).filter((testCase) => !testCase.archivedAt);
    const others = await this.prisma.testCase.findMany({
      where: { projectId: run.projectId, archivedAt: null, id: { notIn: linked.map((testCase) => testCase.id) } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: OTHER_CASES_SENT,
      select: { id: true, title: true },
    });
    return {
      requirement: { title: requirement.title, description: requirement.description },
      extraContext: input.extraContext || null,
      linkedCases: linked.map((testCase) => ({
        title: testCase.title,
        steps: testCase.steps.map((s) => ({ action: s.action, expectedResult: s.expectedResult ?? undefined })),
      })),
      otherCases: others,
    };
  }

  /**
   * One step: its saved answer when it has one, else a model call. What the provider sends back is read and checked
   * by us (the way a server is asked for a structured answer is a request, not a promise), and an answer that can't
   * be used is asked for again, up to three times in all, each time saying what was wrong. In Automatic a failure of
   * the answer's form also changes how it is asked (a JSON schema, then a tool call, then json_object); when a way
   * works after another failed, the setting remembers it, so the next run starts there. A pinned way is kept. Between
   * calls the run is read again, so a cancel takes effect as soon as the step in flight returns.
   */
  private async runStep<I, O>(
    runId: string,
    getProvider: () => Promise<ProviderHandle>,
    name: StepName,
    skill: AiSkill<I, O>,
    input: I,
    guidance: { items: { title: string; body: string }[]; tokens: number },
  ): Promise<O> {
    // The step's own prompt, then the team's guidance for it (nothing when none applies).
    const block = renderTeamGuidance(guidance.items);
    const system = block === "" ? skill.system : `${skill.system}\n\n${block}`;
    // How many times asking another way is due, and what to quote back on the next try.
    let ways: number | undefined;
    let previous: Repair | undefined;
    for (;;) {
      await this.assertStillRunning(runId);
      const rows = await this.prisma.aiWorkflowStep.findMany({ where: { runId, name }, orderBy: { attempt: "asc" } });
      const done = rows.find((row) => row.status === "COMPLETED");
      if (done) return done.output as unknown as O;
      if (rows.length >= MAX_ATTEMPTS_PER_STEP) throw new RunFailure(rows[rows.length - 1].error ?? "The step failed");
      if ((await this.prisma.aiWorkflowStep.count({ where: { runId } })) >= MAX_MODEL_CALLS) {
        throw new RunFailure("Model call limit reached");
      }

      // Before the step is recorded: a run that must stop here has no step for a call that was never made.
      const { provider, timeoutMs, credential, settingsId, anthropic, outputMode, learnedMode } = await getProvider();
      // After a restart the ways already tried are known from the steps; one that was cut off says nothing about its way.
      ways ??= new Set(rows.filter((row) => row.status === "FAILED" && row.error !== INTERRUPTED).map((row) => row.mode)).size;
      const mode = anthropic ? "TOOL_CALL" : modeFor(outputMode, learnedMode, ways);
      const user = skill.user(input);
      const row = await this.prisma.aiWorkflowStep.create({
        data: {
          runId,
          name,
          skillVersion: skill.version,
          attempt: (rows[rows.length - 1]?.attempt ?? 0) + 1,
          mode,
          guidanceTokens: guidance.items.length > 0 ? guidance.tokens : null,
          input: { user },
        },
      });
      // The claim has to outlast the call, whatever the setting's timeout is.
      await this.extendLock(runId, Math.max(RUN_LOCK_MS, timeoutMs + 60_000));
      // What the provider used is known as soon as it answers, even when the answer turns out to be unusable.
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      try {
        const result = await provider.generate({
          system,
          user,
          schemaName: skill.schemaName,
          schema: stripBounds(skill.schema),
          mode,
          repair: previous,
        });
        usage = result.usage;
        const output = skill.validate(result.output);
        await this.prisma.aiWorkflowStep.update({
          where: { id: row.id },
          data: {
            status: "COMPLETED",
            output: output as unknown as Prisma.InputJsonValue,
            usage: result.usage as unknown as Prisma.InputJsonValue,
            endedAt: new Date(),
          },
        });
        await this.extendLock(runId, RUN_LOCK_MS);
        // A way that worked after another failed is what this setting's server keeps to.
        if (!anthropic && outputMode === "AUTO" && mode !== modeFor(outputMode, learnedMode, 0)) await this.rememberMode(settingsId, mode);
        return output;
      } catch (error) {
        const message = scrubProviderError(
          error instanceof AiProviderError ? error.message : "The step failed unexpectedly",
          credential,
        );
        await this.prisma.aiWorkflowStep.update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            error: message,
            endedAt: new Date(),
            ...(usage ? { usage: usage as unknown as Prisma.InputJsonValue } : {}),
          },
        });
        if (!(error instanceof AiProviderError)) {
          this.logger.error(`AI step ${name} of run ${runId} failed unexpectedly: ${error instanceof Error ? error.stack : String(error)}`);
          throw new RunFailure(message);
        }
        // A way the server refuses is only worth another look in Automatic, which asks another way.
        if (!(error.retryable || (outputMode === "AUTO" && error.unsupportedMode))) throw new RunFailure(message);
        if (error.escalate && !anthropic) ways += 1;
        previous = error.rawAnswer ? { answer: error.rawAnswer, problem: error.problem ?? "it was unusable" } : undefined;
      }
    }
  }

  /** Remembers how this setting's server was asked successfully, unless it was changed or pinned since. */
  private async rememberMode(settingsId: string, mode: AiOutputMode): Promise<void> {
    await this.prisma.aiSettings.updateMany({
      where: { id: settingsId, outputMode: "AUTO" },
      data: { learnedMode: mode },
    });
  }

  private async assertStillRunning(runId: string): Promise<void> {
    const run = await this.prisma.aiWorkflowRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!run || run.status !== "RUNNING") throw new RunStopped();
  }

  private async extendLock(runId: string, ms: number): Promise<void> {
    await this.prisma.aiWorkflowRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { lockedUntil: new Date(Date.now() + ms) },
    });
  }

  private async fail(run: AiWorkflowRun, message: string): Promise<void> {
    const failed = await this.prisma.aiWorkflowRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: { status: "FAILED", error: message, finishedAt: new Date(), lockedUntil: null },
    });
    if (failed.count === 0) return;
    await this.audit.record({
      userId: run.createdById,
      projectId: run.projectId,
      action: "ai.run.failed",
      entityType: "ai_workflow_run",
      entityId: run.id,
      metadata: { error: message },
    });
  }
}

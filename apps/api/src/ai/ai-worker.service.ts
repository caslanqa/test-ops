import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiRunExecutor, RUN_LOCK_MS } from "./ai-run-executor";

/** How often an idle worker looks for a run. */
const POLL_MS = 2000;
/** How long shutdown waits for a model call that is in flight; the lock expiry recovers the rest. */
const SHUTDOWN_GRACE_MS = 10_000;

/**
 * The background worker of the AI assistant: one loop in the API process that claims queued runs one at a time
 * and hands them to AiRunExecutor. The claim is a single UPDATE … FOR UPDATE SKIP LOCKED, so several replicas
 * can run it without taking the same run, and no queue server is needed. A run whose claim has run out (the
 * process died) is claimed again and resumes.
 */
@Injectable()
export class AiWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiWorkerService.name);
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<void> | undefined;
  private stopping = false;
  private lastError = "";

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: AiRunExecutor,
  ) {}

  onModuleInit() {
    this.schedule(POLL_MS);
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (!this.current) return;
    let grace: NodeJS.Timeout | undefined;
    await Promise.race([this.current, new Promise((resolve) => (grace = setTimeout(resolve, SHUTDOWN_GRACE_MS)))]);
    if (grace) clearTimeout(grace);
  }

  private schedule(ms: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.current = this.tick().finally(() => {
        this.current = undefined;
      });
    }, ms);
  }

  /** One turn: claim a run, carry it out, and come straight back for the next one; idle, wait. */
  private async tick() {
    let busy = false;
    try {
      const runId = await this.claim();
      if (runId) {
        busy = true;
        await this.executor.execute(runId);
      }
      this.lastError = "";
    } catch (error) {
      // The same failure (the database is down) is logged once, not every two seconds.
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.lastError) this.logger.error(`AI worker: ${message}`);
      this.lastError = message;
    }
    this.schedule(busy ? 0 : POLL_MS);
  }

  /** Claims the oldest run that is queued, or whose claim has run out; null when there is none. */
  private async claim(): Promise<string | null> {
    // Timestamps are stored in UTC without a zone, so the comparison is made in UTC too.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE ai_workflow_runs
      SET status = 'RUNNING',
          "startedAt" = COALESCE("startedAt", timezone('utc', now())),
          "lockedUntil" = timezone('utc', now()) + ${RUN_LOCK_MS / 1000}::double precision * interval '1 second'
      WHERE id = (
        SELECT id FROM ai_workflow_runs
        WHERE (status = 'QUEUED' AND "availableAt" <= timezone('utc', now()))
           OR (status = 'RUNNING' AND "lockedUntil" < timezone('utc', now()))
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id`;
    return rows[0]?.id ?? null;
  }
}

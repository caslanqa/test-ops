import type { AiGuidanceStep } from "@prisma/client";
import type { GuidanceResolver } from "./guidance-resolver.service";
import { estimateTokens, pickForStep, type GuidanceSelection } from "./resolve-guidance";

/** The names of a run's steps; a revision is a design step again, and the audit after it an audit step. */
export type RunStepName = "REVIEW" | "DESIGN" | "AUDIT" | "REVISE" | "AUDIT_REVISED";
type GuidedStep = "REVIEW" | "DESIGN" | "AUDIT";

const GUIDED_STEPS: readonly (GuidedStep & AiGuidanceStep)[] = ["REVIEW", "DESIGN", "AUDIT"];
const GUIDED_STEP_OF: Record<RunStepName, GuidedStep> = {
  REVIEW: "REVIEW",
  DESIGN: "DESIGN",
  REVISE: "DESIGN",
  AUDIT: "AUDIT",
  AUDIT_REVISED: "AUDIT",
};

/** One guidance a run used, with the text it was sent: deleting or editing the guidance later must not change a run. */
export interface GuidanceSnapshotItem {
  scope: "BUILTIN" | "WORKSPACE" | "PROJECT";
  title: string;
  version: number;
  steps: AiGuidanceStep[];
  tokens: number;
  text: string;
}

/**
 * What a run was started with, kept on the run (`ai_workflow_runs.guidance`): the selection, the budget, the text of
 * every guidance it used, and which of them each step is sent. The steps read this and never the live guidance, so a
 * guidance edited, switched off or deleted while a run waits or works changes nothing about it.
 */
export interface GuidanceSnapshot {
  mode: GuidanceSelection["mode"];
  /** The ids a list named, sorted; only for a list. */
  ids?: string[];
  budgetTokens: number;
  /** By guidance id (or `builtin:<key>`). */
  items: Record<string, GuidanceSnapshotItem>;
  /** The refs each step is sent, in prompt order. */
  perStep: Record<GuidedStep, string[]>;
  /** What did not fit the budget, per step. */
  dropped: { step: GuidedStep; ref: string; title: string; tokens: number }[];
}

/** The snapshot without the text: what the run view shows. */
export type PublicGuidanceSnapshot = Omit<GuidanceSnapshot, "items"> & {
  items: Record<string, Omit<GuidanceSnapshotItem, "text">>;
};

/** Resolves the selection for every step of a run, as it is now, within the project's budget. */
export async function buildSnapshot(
  resolver: GuidanceResolver,
  projectId: string,
  selection: GuidanceSelection,
  options: { inEffectOnly?: boolean } = {},
): Promise<GuidanceSnapshot> {
  const [candidates, budgetTokens] = await Promise.all([
    resolver.candidatesFor(projectId, selection, options),
    resolver.budgetFor(projectId),
  ]);
  const items: GuidanceSnapshot["items"] = {};
  const perStep: GuidanceSnapshot["perStep"] = { REVIEW: [], DESIGN: [], AUDIT: [] };
  const dropped: GuidanceSnapshot["dropped"] = [];
  for (const step of GUIDED_STEPS) {
    const picked = pickForStep(candidates, step, budgetTokens);
    perStep[step] = picked.used.map((candidate) => candidate.ref);
    for (const candidate of picked.used) {
      items[candidate.ref] ??= {
        scope: candidate.scope,
        title: candidate.title,
        version: candidate.version,
        steps: candidate.steps,
        tokens: estimateTokens(candidate.body),
        text: candidate.body,
      };
    }
    dropped.push(...picked.dropped.map((entry) => ({ step, ...entry })));
  }
  return {
    mode: selection.mode,
    ...(selection.mode === "LIST" ? { ids: [...new Set(selection.ids ?? [])].sort() } : {}),
    budgetTokens,
    items,
    perStep,
    dropped,
  };
}

/**
 * What a step is sent: the guidance of its kind of step, in prompt order, and what that costs. A run from before
 * guidance existed has no snapshot and is sent none.
 */
export function guidanceForStep(
  snapshot: GuidanceSnapshot | null,
  stepName: RunStepName,
): { items: { title: string; body: string }[]; tokens: number } {
  if (!snapshot) return { items: [], tokens: 0 };
  const chosen = (snapshot.perStep[GUIDED_STEP_OF[stepName]] ?? []).flatMap((ref) => (snapshot.items[ref] ? [snapshot.items[ref]] : []));
  return {
    items: chosen.map((item) => ({ title: item.title, body: item.text })),
    tokens: chosen.reduce((sum, item) => sum + item.tokens, 0),
  };
}

/** The snapshot as people see it: what was used and left out, never the text. */
export function publicSnapshot(snapshot: GuidanceSnapshot | null): PublicGuidanceSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    items: Object.fromEntries(
      Object.entries(snapshot.items).map(([ref, { scope, title, version, steps, tokens }]) => [ref, { scope, title, version, steps, tokens }]),
    ),
  };
}

/** Whether two selections ask for the same thing: the same mode, and for a list the same ids in any order. */
export function sameSelections(a: GuidanceSelection, b: GuidanceSelection): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode !== "LIST") return true;
  const left = [...new Set(a.ids ?? [])].sort();
  const right = [...new Set(b.ids ?? [])].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Whether a run was started with this selection: two starts are the same start only if they ask for the same thing.
 * A list is the same list in whatever order its ids come. A run from before guidance existed used none.
 */
export function sameSelection(snapshot: GuidanceSnapshot | null, selection: GuidanceSelection): boolean {
  if ((snapshot?.mode ?? "NONE") !== selection.mode) return false;
  if (selection.mode !== "LIST") return true;
  const kept = snapshot?.ids ?? [];
  const asked = [...new Set(selection.ids ?? [])].sort();
  return kept.length === asked.length && kept.every((id, index) => id === asked[index]);
}

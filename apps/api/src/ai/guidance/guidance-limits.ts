import { AiGuidanceStep } from "@prisma/client";

/** The sizes the guidance feature keeps to (spec: docs/superpowers/specs/2026-10-27-ai-guidance-design.md, "Data"). */
export const GUIDANCE_LIMITS = {
  title: 200,
  summary: 500,
  body: 20_000,
  sourceName: 200,
  sourceUrl: 2000,
  license: 200,
  /** Higher ranks first in the prompt and is kept longest when the budget is short. */
  priority: { min: 0, max: 1000, default: 500 },
  /** Guidance a workspace, or a project, can hold. */
  perOwner: 100,
  /** The most guidance a run (or a preview) can name by id. */
  selectionIds: 20,
} as const;

/** The most tokens of guidance one step's prompt may carry: an AI setting's `guidanceBudgetTokens`; 0 means no limit. */
export const GUIDANCE_BUDGET_TOKENS = { min: 0, max: 200_000, default: 6000 } as const;

/** The steps in the order they are shown and stored, whatever order a request names them in. */
const STEP_ORDER: readonly AiGuidanceStep[] = [
  AiGuidanceStep.REVIEW,
  AiGuidanceStep.DESIGN,
  AiGuidanceStep.AUDIT,
  AiGuidanceStep.CODEGEN,
];

/** Each step once, in the usual order, so the same set of steps is always stored the same way. */
export const normalizeSteps = (steps: readonly AiGuidanceStep[]): AiGuidanceStep[] =>
  STEP_ORDER.filter((step) => steps.includes(step));

/**
 * What a guidance costs in the prompt: about a token per four characters, plus 30 for the title and the framing
 * around it. It over-estimates on purpose, so a budget is never exceeded by the real tokenizer.
 */
export const estimateTokens = (body: string): number => Math.ceil(body.length / 4) + 30;

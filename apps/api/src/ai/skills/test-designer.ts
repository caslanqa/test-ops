import { checkShape, DATA_NOT_INSTRUCTIONS, type AiSkill } from "./skill";
import { renderCriteria, renderDrafts, renderRequirement } from "./prompts";
import type { Audit, CaseDraft, Review, RunContext } from "./types";
import type { JsonSchema } from "../validate-output";

export const CASE_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const CASE_TYPES = ["FUNCTIONAL", "SMOKE", "REGRESSION", "SECURITY", "PERFORMANCE", "OTHER"];
export const DRAFT_KINDS = ["positive", "negative", "boundary", "error"];

export const DESIGN_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cases"],
  properties: {
    cases: {
      type: "array",
      maxItems: 25,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "preconditions", "steps", "priority", "type", "kind"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 300 },
          // Structured output modes want every property required, so "none" is null rather than missing.
          preconditions: { type: ["string", "null"], maxLength: 2000 },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["action", "expectedResult"],
              properties: {
                action: { type: "string", minLength: 1, maxLength: 1000 },
                expectedResult: { type: ["string", "null"], maxLength: 1000 },
              },
            },
          },
          priority: { type: "string", enum: CASE_PRIORITIES },
          type: { type: "string", enum: CASE_TYPES },
          kind: { type: "string", enum: DRAFT_KINDS },
        },
      },
    },
  },
};

interface RawCase {
  title: string;
  preconditions: string | null;
  steps: { action: string; expectedResult: string | null }[];
  priority: string;
  type: string;
  kind: CaseDraft["kind"];
}

/** The model's answer as drafts: "none" (null) becomes a missing field, as in CreateTestCaseDto. */
function toDrafts(output: unknown): { cases: CaseDraft[] } {
  checkShape(DESIGN_SCHEMA, output);
  const raw = (output as { cases: RawCase[] }).cases;
  return {
    cases: raw.map((c) => ({
      title: c.title.trim(),
      preconditions: c.preconditions?.trim() || undefined,
      steps: c.steps.map((step) => ({ action: step.action.trim(), expectedResult: step.expectedResult?.trim() || undefined })),
      priority: c.priority,
      type: c.type,
      kind: c.kind,
    })),
  };
}

const SYSTEM = [
  "You are a test designer on a software test team. You turn a requirement and its acceptance criteria into test cases.",
  DATA_NOT_INSTRUCTIONS,
  "Write at most 25 cases that together cover every acceptance criterion: positive, negative, boundary and error cases.",
  "Each case has a short title, preconditions (null when there are none), at least one step with an action and the expected result (null when a step has none),",
  `a priority (${CASE_PRIORITIES.join(", ")}), a type (${CASE_TYPES.join(", ")}) and a kind (${DRAFT_KINDS.join(", ")}).`,
  "Do not repeat a case the team already has. Write in the language of the requirement. Answer only in the requested JSON shape.",
].join("\n");

export interface DesignInput {
  context: RunContext;
  review: Review;
}

export interface ReviseInput extends DesignInput {
  previous: CaseDraft[];
  audit: Audit;
}

/** Drafts test cases for a reviewed requirement. */
export const testDesigner: AiSkill<DesignInput, { cases: CaseDraft[] }> = {
  name: "DESIGN",
  version: 1,
  schemaName: "test_design",
  schema: DESIGN_SCHEMA,
  system: SYSTEM,
  user: ({ context, review }) => [renderRequirement(context), renderCriteria(review)].join("\n"),
  validate: toDrafts,
};

/** The same designer, given the auditor's notes and its own earlier drafts, to fix what the audit found. */
export const testReviser: AiSkill<ReviseInput, { cases: CaseDraft[] }> = {
  name: "REVISE",
  version: 1,
  schemaName: "test_design",
  schema: DESIGN_SCHEMA,
  system: `${SYSTEM}\nYou are revising your earlier drafts after a coverage audit: answer with the complete corrected list of cases, not only the changes.`,
  user: ({ context, review, previous, audit }) =>
    [
      renderRequirement(context),
      renderCriteria(review),
      renderDrafts(previous),
      "<audit>",
      `Notes: ${audit.notes}`,
      `Uncovered criteria: ${audit.uncovered.join(", ") || "none"}`,
      `Duplicates of existing cases: ${audit.duplicates.map((d) => `${d.caseIndex} (${d.reason})`).join("; ") || "none"}`,
      "</audit>",
    ].join("\n"),
  validate: toDrafts,
};

import { checkShape, clip, DATA_NOT_INSTRUCTIONS, type AiSkill } from "./skill";
import { renderCriteria, renderDrafts, renderRequirement } from "./prompts";
import type { Audit, CaseDraft, Review, RunContext } from "./types";
import type { JsonSchema } from "../validate-output";

export const AUDIT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["coverage", "uncovered", "duplicates", "revisionNeeded", "notes"],
  properties: {
    coverage: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "caseIndexes"],
        properties: {
          criterion: { type: "integer", minimum: 0 },
          caseIndexes: { type: "array", maxItems: 25, items: { type: "integer", minimum: 0 } },
        },
      },
    },
    uncovered: { type: "array", maxItems: 20, items: { type: "integer", minimum: 0 } },
    duplicates: {
      type: "array",
      maxItems: 25,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["caseIndex", "existingCaseId", "reason"],
        properties: {
          caseIndex: { type: "integer", minimum: 0 },
          existingCaseId: { type: "string", minLength: 1, maxLength: 100 },
          reason: { type: "string", maxLength: 500 },
        },
      },
    },
    revisionNeeded: { type: "boolean" },
    notes: { type: "string", maxLength: 2000 },
  },
};

export interface AuditInput {
  context: RunContext;
  review: Review;
  drafts: CaseDraft[];
}

/** Checks which acceptance criteria the drafts cover, and whether a draft repeats a case the project has. */
export const coverageAuditor: AiSkill<AuditInput, Audit> = {
  name: "AUDIT",
  version: 1,
  schemaName: "coverage_audit",
  schema: AUDIT_SCHEMA,
  system: [
    "You are a coverage auditor on a software test team. You compare draft test cases with the acceptance criteria of a requirement.",
    DATA_NOT_INSTRUCTIONS,
    "Criteria and draft cases are numbered from 0. For each criterion list the numbers of the drafts that cover it, list the criteria no draft covers,",
    "and list drafts that repeat one of the project's existing cases (the draft's number, the existing case's id exactly as given, and a short reason).",
    "Set revisionNeeded to true only when a criterion is uncovered or a draft repeats an existing case. In notes, say in one or two sentences what the designer should fix.",
    "Answer only in the requested JSON shape.",
  ].join("\n"),
  user: ({ context, review, drafts }) =>
    [
      renderRequirement(context),
      renderCriteria(review),
      renderDrafts(drafts),
      "<existing_cases_of_the_project>",
      ...context.otherCases.map((c) => `${c.id} | ${clip(c.title, 300)}`),
      "</existing_cases_of_the_project>",
    ].join("\n"),
  validate(output) {
    checkShape(AUDIT_SCHEMA, output);
    return output as Audit;
  },
};

/**
 * Drops what points at nothing: a criterion or draft number out of range, and a duplicate of a case that wasn't
 * in the list (a model can invent an id). What is left is safe to show next to the drafts.
 */
export function sanitizeAudit(audit: Audit, criteria: number, drafts: number, knownCaseIds: Set<string>): Audit {
  const draftIndexes = (indexes: number[]) => [...new Set(indexes)].filter((index) => index < drafts);
  return {
    coverage: audit.coverage
      .filter((entry) => entry.criterion < criteria)
      .map((entry) => ({ criterion: entry.criterion, caseIndexes: draftIndexes(entry.caseIndexes) })),
    uncovered: [...new Set(audit.uncovered)].filter((index) => index < criteria),
    duplicates: audit.duplicates.filter((d) => d.caseIndex < drafts && knownCaseIds.has(d.existingCaseId)),
    revisionNeeded: audit.revisionNeeded,
    notes: audit.notes,
  };
}

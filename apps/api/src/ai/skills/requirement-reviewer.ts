import { checkShape, DATA_NOT_INSTRUCTIONS, type AiSkill } from "./skill";
import { renderRequirement } from "./prompts";
import type { Review, RunContext } from "./types";
import type { JsonSchema } from "../validate-output";

const KINDS = ["clarity", "testability", "acceptance-criteria", "risk", "question"];
const SEVERITIES = ["low", "medium", "high"];

export const REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "acceptanceCriteria", "findings"],
  properties: {
    summary: { type: "string", maxLength: 2000 },
    acceptanceCriteria: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 1000 } },
    findings: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "severity", "text"],
        properties: {
          kind: { type: "string", enum: KINDS },
          severity: { type: "string", enum: SEVERITIES },
          text: { type: "string", minLength: 1, maxLength: 1000 },
        },
      },
    },
  },
};

/** Reads one requirement and says what is unclear, what is hard to test, and what a test must show. */
export const requirementReviewer: AiSkill<RunContext, Review> = {
  name: "REVIEW",
  version: 1,
  schemaName: "requirement_review",
  schema: REVIEW_SCHEMA,
  system: [
    "You are a requirement reviewer on a software test team. You read one requirement and judge it for testing.",
    DATA_NOT_INSTRUCTIONS,
    "Write a short summary, then the acceptance criteria a tester would check: at most 20 short, testable statements that restate or complete the requirement.",
    `Then at most 30 findings. Each has a kind (${KINDS.join(", ")}), a severity (${SEVERITIES.join(", ")}) and one sentence of text.`,
    "Write in the language of the requirement. Answer only in the requested JSON shape.",
  ].join("\n"),
  user: renderRequirement,
  validate(output) {
    checkShape(REVIEW_SCHEMA, output);
    return output as Review;
  },
};

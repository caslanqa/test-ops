import { clip } from "./skill";
import type { CaseDraft, Review, RunContext } from "./types";

/** The requirement and what the team already has, as the text every step starts from. */
export function renderRequirement(context: RunContext): string {
  const lines = [
    "<requirement>",
    `Title: ${clip(context.requirement.title, 500)}`,
    `Description: ${clip(context.requirement.description, 20000)}`,
    "</requirement>",
  ];
  if (context.extraContext) lines.push("<extra_context>", clip(context.extraContext, 8000), "</extra_context>");
  if (context.linkedCases.length > 0) {
    lines.push("<existing_cases_for_this_requirement>");
    for (const linked of context.linkedCases) {
      lines.push(`- ${clip(linked.title, 300)}: ${linked.steps.map((step) => clip(step.action, 300)).join("; ")}`);
    }
    lines.push("</existing_cases_for_this_requirement>");
  }
  return lines.join("\n");
}

export function renderCriteria(review: Review): string {
  return ["<acceptance_criteria>", ...review.acceptanceCriteria.map((text, index) => `${index}. ${clip(text, 1000)}`), "</acceptance_criteria>"].join("\n");
}

export function renderDrafts(drafts: CaseDraft[]): string {
  return [
    "<draft_cases>",
    ...drafts.map(
      (draft, index) =>
        `${index}. [${draft.kind}] ${clip(draft.title, 300)}: ${draft.steps
          .map((step) => `${clip(step.action, 300)}${step.expectedResult ? ` => ${clip(step.expectedResult, 300)}` : ""}`)
          .join("; ")}`,
    ),
    "</draft_cases>",
  ].join("\n");
}

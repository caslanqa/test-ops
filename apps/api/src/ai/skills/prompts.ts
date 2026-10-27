import { clip } from "./skill";
import type { CaseDraft, Review, RunContext } from "./types";

/** The most linked cases a prompt lists, how many of their steps, and how many characters they may take together. */
export const MAX_LINKED_CASES = 50;
const MAX_STEPS_PER_LINKED_CASE = 10;
const LINKED_CASES_BUDGET = 30_000;

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
    // A requirement can have hundreds of linked cases: the first few, within a size budget, tell the model what
    // exists; the rest would only overflow its context and fail the run.
    let used = 0;
    let shown = 0;
    for (const linked of context.linkedCases) {
      const line = `- ${clip(linked.title, 300)}: ${linked.steps.slice(0, MAX_STEPS_PER_LINKED_CASE).map((step) => clip(step.action, 300)).join("; ")}`;
      if (shown >= MAX_LINKED_CASES || used + line.length > LINKED_CASES_BUDGET) break;
      lines.push(line);
      used += line.length;
      shown++;
    }
    const left = context.linkedCases.length - shown;
    if (left > 0) lines.push(`(${left} more linked ${left === 1 ? "case is" : "cases are"} not shown)`);
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

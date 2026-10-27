import type { AiOutputMode } from "@prisma/client";
import { clip } from "../skills/skill";

/** How one request asks for a structured answer: an AiOutputMode that is not AUTO. */
export type AnswerMode = Exclude<AiOutputMode, "AUTO">;

/** What AUTO tries, in this order. PROMPT is left out: it only works by luck, so it is something a person pins. */
export const AUTO_LADDER: AnswerMode[] = ["JSON_SCHEMA", "TOOL_CALL", "JSON_OBJECT"];

/**
 * The way to ask on a try: the pinned one, or, in AUTO, step `index` of the ladder, which starts with what was
 * learned (what worked before) and goes on with the others in order. Past the end it stays on the last.
 */
export function modeFor(outputMode: AiOutputMode, learned: AiOutputMode | null, index: number): AnswerMode {
  if (outputMode !== "AUTO") return outputMode;
  const first = learned && (AUTO_LADDER as string[]).includes(learned) ? (learned as AnswerMode) : null;
  const ladder = first ? [first, ...AUTO_LADDER.filter((mode) => mode !== first)] : AUTO_LADDER;
  return ladder[Math.min(index, ladder.length - 1)];
}

/** The most of a rejected answer that is sent back to the model. */
const REPAIR_ANSWER_CHARS = 8000;

/** A rejected answer and why, for the next try to put right. */
export interface Repair {
  answer: string;
  problem: string;
}

/** The user message of a retry: the original, then what was wrong. The rejected answer is data, not orders. */
export function withRepair(user: string, repair: Repair | undefined): string {
  if (!repair) return user;
  return [
    user,
    "",
    `Your previous answer was rejected: ${repair.problem}.`,
    "<previous_answer>",
    clip(repair.answer, REPAIR_ANSWER_CHARS),
    "</previous_answer>",
    "Answer again with only the corrected JSON object, nothing else.",
  ].join("\n");
}

/** For the ways that carry no schema in the request itself: the schema, written out in the system prompt. */
export function withSchemaInstruction(system: string, schema: object): string {
  return `${system}\n\nAnswer with a single JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(schema)}`;
}

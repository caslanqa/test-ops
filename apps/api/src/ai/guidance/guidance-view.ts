import { BadRequestException } from "@nestjs/common";
import type { AiGuidanceStep } from "@prisma/client";
import type { Response } from "express";
import type { ResolvedGuidance } from "./guidance-resolver.service";
import { estimateTokens, type GuidanceSelection } from "./resolve-guidance";

/** A selection from a query: `ids` belong to `LIST` and to nothing else. */
export function selectionFromQuery(mode: GuidanceSelection["mode"] | undefined, ids: string | undefined): GuidanceSelection {
  const chosen = mode ?? "EFFECTIVE";
  if (chosen !== "LIST") {
    if (ids !== undefined) throw new BadRequestException("ids go with selection=LIST");
    return { mode: chosen };
  }
  return {
    mode: chosen,
    ids: (ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  };
}

const STEP_WORDS: Record<AiGuidanceStep, string> = {
  REVIEW: "requirement review",
  DESIGN: "case design",
  AUDIT: "coverage audit",
  CODEGEN: "code generation",
};

/** A title or a source is one line: a line break in it must not start a heading of its own. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * The guidance of one step as one markdown document, for a coding agent to read: a heading for each guidance with where
 * it comes from, its version and priority, then its text, and what the token budget left out at the end.
 */
export function renderGuidanceMarkdown(step: AiGuidanceStep, resolved: ResolvedGuidance): string {
  const lines = [`# Team guidance for ${STEP_WORDS[step]}`, ""];
  if (resolved.used.length === 0) {
    lines.push("No guidance applies to this step.");
  } else {
    const budget = resolved.budgetTokens === 0 ? "no limit" : `${resolved.budgetTokens} tokens`;
    lines.push(`${resolved.used.length} guidance, about ${resolved.usedTokens} tokens (budget: ${budget}).`);
    for (const item of resolved.used) {
      lines.push(
        "",
        `## ${oneLine(item.title)}`,
        "",
        `Source: ${oneLine(item.source ?? "Written in TestOps")} · Version ${item.version} · Priority ${item.priority}`,
        "",
        item.body,
      );
    }
  }
  if (resolved.dropped.length > 0) {
    lines.push("", `## Left out (over the budget of ${resolved.budgetTokens} tokens)`, "");
    for (const entry of resolved.dropped) lines.push(`- ${oneLine(entry.title)} (${entry.tokens} tokens)`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The answer for resolved guidance: the exact block as plain text, one markdown document, or the used and left-out
 * guidance with their text. Express adds an ETag to each, so asking again with it costs nothing while nothing changed.
 */
export function guidanceAnswer(
  response: Response,
  format: "json" | "prompt" | "markdown" | undefined,
  step: AiGuidanceStep,
  selection: GuidanceSelection,
  resolved: ResolvedGuidance,
) {
  if (format === "prompt") {
    response.type("text/plain");
    return resolved.prompt;
  }
  if (format === "markdown") {
    response.type("text/markdown");
    return renderGuidanceMarkdown(step, resolved);
  }
  return {
    step,
    selection: selection.mode,
    budgetTokens: resolved.budgetTokens,
    usedTokens: resolved.usedTokens,
    used: resolved.used.map((item) => ({
      ref: item.ref,
      scope: item.scope,
      title: item.title,
      version: item.version,
      priority: item.priority,
      tokens: estimateTokens(item.body),
      source: item.source ?? null,
      body: item.body,
    })),
    dropped: resolved.dropped,
  };
}

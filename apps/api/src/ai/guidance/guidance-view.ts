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

/** The answer for resolved guidance: the exact block as plain text, or the used and left-out guidance with their text. */
export function guidanceAnswer(
  response: Response,
  format: "json" | "prompt" | undefined,
  step: AiGuidanceStep,
  selection: GuidanceSelection,
  resolved: ResolvedGuidance,
) {
  if (format === "prompt") {
    response.type("text/plain");
    return resolved.prompt;
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
      body: item.body,
    })),
    dropped: resolved.dropped,
  };
}

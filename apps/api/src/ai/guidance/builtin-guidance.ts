import { Injectable } from "@nestjs/common";
import { AiGuidanceKind, AiGuidanceStep } from "@prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GUIDANCE_LIMITS, normalizeSteps } from "./guidance-limits";
import { splitFrontmatter } from "./skill-markdown";

/** A guidance that ships in the image: it belongs to nobody, and a workspace or a project switches it on or off. */
export interface BuiltinGuidance {
  key: string;
  title: string;
  summary: string;
  kind: AiGuidanceKind;
  steps: AiGuidanceStep[];
  priority: number;
  version: number;
  /** The licence the text is under, shown with it. */
  license: string;
  /** Where it comes from, shown with it: written for TestOps, or adapted from a named source. */
  origin: string;
  body: string;
}

/** What names a built-in pack in a selection of a run: `builtin:<key>`. */
export const BUILTIN_REF_PREFIX = "builtin:";
export const builtinRef = (key: string): string => `${BUILTIN_REF_PREFIX}${key}`;

/** `apps/api/guidance/builtin`, whether this runs from `src` or from `dist` (both are one folder below `apps/api`). */
const DEFAULT_DIR = join(__dirname, "..", "..", "..", "guidance", "builtin");

const KEY = /^[a-z0-9][a-z0-9-]*$/;
const KINDS: readonly string[] = Object.values(AiGuidanceKind);
const STEPS: readonly string[] = Object.values(AiGuidanceStep);
const WHOLE_NUMBER = /^\d{1,9}$/;

function parsePack(file: string, content: string): BuiltinGuidance {
  const fail = (message: string): never => {
    throw new Error(`Built-in guidance ${file}: ${message}`);
  };
  const { fields, body } = splitFrontmatter(content);
  const text = (name: string, max: number): string => {
    const value = fields[name];
    if (typeof value !== "string" || value.trim() === "") return fail(`"${name}" is missing`);
    return value.trim().length > max ? fail(`"${name}" is longer than ${max} characters`) : value.trim();
  };
  const whole = (name: string, min: number, max: number): number => {
    const value = fields[name];
    const number = typeof value === "string" && WHOLE_NUMBER.test(value.trim()) ? Number(value.trim()) : Number.NaN;
    return number >= min && number <= max ? number : fail(`"${name}" must be a whole number from ${min} to ${max}`);
  };

  const key = text("key", 100);
  if (!KEY.test(key) || key !== file.replace(/\.md$/, "")) {
    fail(`"key" must be the file name without .md, in lower-case letters, digits and dashes`);
  }
  const kind = text("kind", 40);
  if (!KINDS.includes(kind)) fail(`"kind" must be one of ${KINDS.join(", ")}`);
  const steps = fields.steps;
  if (!Array.isArray(steps) || steps.length === 0 || new Set(steps).size !== steps.length || !steps.every((step) => STEPS.includes(step))) {
    fail(`"steps" must list each of ${STEPS.join(", ")} at most once, in square brackets, at least one`);
  }
  if (body === "") fail("there is no text after the header");
  if (body.length > GUIDANCE_LIMITS.builtinBody) {
    fail(`the text is ${body.length} characters; at most ${GUIDANCE_LIMITS.builtinBody.toLocaleString("en")}`);
  }
  return {
    key,
    title: text("title", GUIDANCE_LIMITS.title),
    summary: text("summary", GUIDANCE_LIMITS.summary),
    kind: kind as AiGuidanceKind,
    steps: normalizeSteps(steps as AiGuidanceStep[]),
    priority: whole("priority", GUIDANCE_LIMITS.priority.min, GUIDANCE_LIMITS.priority.max),
    version: whole("version", 1, 1_000_000),
    license: text("license", GUIDANCE_LIMITS.license),
    origin: text("origin", 500),
    body,
  };
}

/**
 * Reads the packs in a folder, one markdown file each, sorted by key. A file that is wrong in any way is an error that
 * names it: this runs when the app starts, so a pack that can't be read stops the app, never half-loads.
 */
export function loadBuiltinGuidance(dir: string = DEFAULT_DIR): BuiltinGuidance[] {
  const files = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
  return files.map((file) => parsePack(file, readFileSync(join(dir, file), "utf8")));
}

/** The packs of this version of the app, read once at start-up. */
@Injectable()
export class BuiltinGuidanceService {
  private readonly packs: readonly BuiltinGuidance[] = loadBuiltinGuidance();

  all(): readonly BuiltinGuidance[] {
    return this.packs;
  }

  byKey(key: string): BuiltinGuidance | null {
    return this.packs.find((pack) => pack.key === key) ?? null;
  }
}

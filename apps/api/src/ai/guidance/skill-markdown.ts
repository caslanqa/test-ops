import { BadRequestException } from "@nestjs/common";
import { GUIDANCE_LIMITS } from "./guidance-limits";

/** A markdown file split into the fields of its header (the part between two `---` lines) and the text after it. */
export interface Frontmatter {
  fields: Record<string, string | string[]>;
  body: string;
}

/** A top-level `key: value` line: it starts with a key, so an indented (nested) line never matches. */
const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_-]*):(.*)$/;

const unquote = (raw: string): string => {
  const text = raw.trim();
  const quoted = text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")));
  return quoted ? text.slice(1, -1) : text;
};

/** A scalar, or an inline list such as `[Read, "Write"]`. */
const readValue = (raw: string): string | string[] => {
  const text = raw.trim();
  if (text.startsWith("[") && text.endsWith("]")) {
    return text
      .slice(1, -1)
      .split(",")
      .map(unquote)
      .filter((item) => item !== "");
  }
  return unquote(text);
};

/**
 * Splits a markdown file into its header and its text. Written by hand, not with a YAML library: it reads only
 * what a guidance needs (top-level `key: value` lines and inline lists) and ignores everything else, nested keys
 * and block lists included, so a header in a style it does not know costs nothing. A byte-order mark and Windows
 * line endings are accepted. A header that never ends is no header: the whole file is the text.
 */
export function splitFrontmatter(content: string): Frontmatter {
  const text = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trimEnd() !== "---") return { fields: {}, body: text.trim() };
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (end === -1) return { fields: {}, body: text.trim() };

  // No prototype: a key such as `__proto__` is then just a key.
  const fields = Object.create(null) as Record<string, string | string[]>;
  for (const line of lines.slice(1, end)) {
    const match = KEY_LINE.exec(line);
    if (match) fields[match[1]] = readValue(match[2]);
  }
  return { fields, body: lines.slice(end + 1).join("\n").trim() };
}

const scalar = (value: string | string[] | undefined): string => (Array.isArray(value) ? value.join(", ") : (value ?? "")).trim();

/** `e2e-testing` becomes `E2e testing`. */
const humanize = (name: string): string => {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The text of the first markdown heading, or null. Scanned by hand: a pattern for "trailing spaces and hashes" is
 * quadratic on a long line of spaces, and the file is a stranger's.
 */
function firstHeading(body: string): string | null {
  for (const line of body.split("\n")) {
    const opening = /^#{1,6}[ \t]+/.exec(line);
    if (!opening) continue;
    let end = line.length;
    while (end > opening[0].length && (line[end - 1] === " " || line[end - 1] === "\t" || line[end - 1] === "#")) end--;
    const text = line.slice(opening[0].length, end);
    if (text !== "") return text;
  }
  return null;
}

/**
 * What a markdown file (such as a SKILL.md) would make as a guidance: the title from the header's `name` (else the
 * first heading), the summary from its `description`, and the text after the header. Nothing else in the header is
 * used. A title is cut at 200 characters and a summary at 500; a file with no text, or with no name and no heading,
 * is a 400.
 */
export function parseSkillMarkdown(content: string): { title: string; summary: string | null; body: string } {
  const { fields, body } = splitFrontmatter(content);
  if (body === "") throw new BadRequestException("The file has no text after its header to use as guidance");
  const name = scalar(fields.name);
  const description = scalar(fields.description);
  const title = name !== "" ? humanize(name) : firstHeading(body);
  if (!title) throw new BadRequestException("The file has no name in its header and no heading to use as a title");
  return {
    title: title.slice(0, GUIDANCE_LIMITS.title),
    summary: description !== "" ? description.slice(0, GUIDANCE_LIMITS.summary) : null,
    body,
  };
}

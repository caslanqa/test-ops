import { scrubProviderError } from "../provider-error";

/** The longest start of a model's answer that an error message quotes. */
const HINT_CHARS = 160;

/** Unwraps JSON that was encoded twice: a JSON string whose content is itself JSON. */
function unwrapString(value: unknown, depth = 0): unknown {
  if (typeof value !== "string" || depth >= 2) return value;
  try {
    return unwrapString(JSON.parse(value.trim()), depth + 1);
  } catch {
    return value;
  }
}

/**
 * Mends the two slips models make most often when they write JSON by hand: a line break or tab inside a string
 * (JSON wants them escaped) and a comma before a closing bracket. Nothing else is touched, and a comma inside a
 * string stays where it is.
 */
function repairJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
      } else if (ch === "\\") {
        escaped = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next++;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    out += ch;
  }
  return out;
}

/** The most of an answer the fallback readings work on; a longer one is only read as plain JSON. */
const MAX_FALLBACK_CHARS = 256 * 1024;
/** The longest tag after an opening code fence ("json") that is skipped. */
const MAX_FENCE_TAG_CHARS = 30;

/**
 * Removes `<think>…</think>` blocks: what a reasoning model thought is not the answer, and may contain braces of its
 * own. Plain scans for the two markers, each moving forward, so the work is linear however many openings the answer
 * has (a pattern search for an opening with no closing would start over at every opening).
 */
function stripThinkBlocks(raw: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = raw.indexOf("<think>", at);
    if (open === -1) break;
    const close = raw.indexOf("</think>", open + "<think>".length);
    if (close === -1) break;
    out += raw.slice(at, open);
    at = close + "</think>".length;
  }
  return out + raw.slice(at);
}

/** What is between the first code fence's opening line and the next fence, or null when there is no such fence. */
function fenceContents(text: string): string | null {
  const open = text.indexOf("```");
  if (open === -1) return null;
  const newline = text.indexOf("\n", open + 3);
  if (newline === -1 || newline - (open + 3) > MAX_FENCE_TAG_CHARS) return null;
  const close = text.indexOf("```", newline + 1);
  if (close === -1) return null;
  return text.slice(newline + 1, close).trim();
}

/**
 * Reads the JSON a model answered with. A model that was asked for a JSON schema should answer with exactly the
 * JSON, but many servers and models don't keep to it: they wrap it in a code fence, put a sentence before it, think
 * out loud in a `<think>` block first, or encode it twice; and by hand they slip on line breaks inside strings and
 * on trailing commas. The plain text is tried first; only if that isn't JSON are those wrappings undone and the slips
 * mended. The answer comes from a server somebody configured, so nothing here may take longer than a few passes over
 * it: plain scans instead of patterns that start over, and no fallbacks for an answer longer than MAX_FALLBACK_CHARS.
 * Throws when no JSON can be found. What comes back may still be a string, array or number: the caller decides
 * whether that is usable.
 */
export function parseModelJson(raw: string): unknown {
  try {
    return unwrapString(JSON.parse(raw.trim()));
  } catch {
    // Not plain JSON; undo the wrappings below.
  }
  if (raw.length <= MAX_FALLBACK_CHARS) {
    const text = stripThinkBlocks(raw).trim();
    const candidates = [text];
    const fenced = fenceContents(text);
    if (fenced) candidates.push(fenced);
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
    for (const candidate of [...candidates, ...candidates.map(repairJson)]) {
      try {
        return unwrapString(JSON.parse(candidate));
      } catch {
        // Not JSON as it stands; try the next reading.
      }
    }
  }
  throw new SyntaxError("The answer contains no JSON");
}

/** What a parsed answer is, in words, for an error message. */
export function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/**
 * The start of a model's answer for an error message, so a person can see what it sent instead of JSON. Only for a
 * public endpoint: from a private address nothing of the answer is shown (it could be an internal service), as with
 * error bodies. The key is removed and the quote is short.
 */
export function answerHint(answer: string, endpointIsPrivate: boolean, credential: string | null): string {
  if (endpointIsPrivate) return "";
  const flat = scrubProviderError(answer.replace(/\s+/g, " ").trim(), credential);
  if (!flat) return " (it was empty)";
  const start = JSON.stringify(flat.length > HINT_CHARS ? `${flat.slice(0, HINT_CHARS)}…` : flat);
  return ` (it starts with: ${start}${whereItBreaks(answer, credential)})`;
}

/** For an answer that looks like JSON but isn't: what the parser says and the few characters around that point. */
function whereItBreaks(answer: string, credential: string | null): string {
  const text = answer.trim();
  const from = text.indexOf("{");
  if (from === -1) return "";
  try {
    JSON.parse(text.slice(from, text.lastIndexOf("}") + 1 || undefined));
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const position = Number(/position (\d+)/.exec(message)?.[1]);
    const json = text.slice(from);
    const near = Number.isFinite(position)
      ? `, near: ${JSON.stringify(scrubProviderError(json.slice(Math.max(0, position - 40), position + 40).replace(/\s+/g, " "), credential))}`
      : "";
    return `. It breaks at: ${scrubProviderError(message, credential).slice(0, 120)}${near}`;
  }
}

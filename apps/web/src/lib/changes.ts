/**
 * The fields of `next` that differ from `original`, for PATCH bodies: edit forms send only what
 * the person changed. That keeps a stale value (e.g. an assignee who has left the project) from
 * being re-sent and rejected, and keeps a save from overwriting a concurrent edit of a field
 * this person never touched. Values are compared as given, so callers normalize both sides the
 * same way (trimmed text, `null` for empty); arrays are compared by content.
 */
export function changedFields<T extends Record<string, unknown>>(original: T, next: T): Partial<T> {
  const changed: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (JSON.stringify(original[key]) !== JSON.stringify(next[key])) changed[key] = next[key];
  }
  return changed;
}

/** Whether `fields` (from `changedFields`) holds anything to save. */
export function hasChanges(fields: object): boolean {
  return Object.keys(fields).length > 0;
}

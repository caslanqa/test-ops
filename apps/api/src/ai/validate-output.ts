/** The part of JSON Schema (draft-07) that the AI skills use. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

function hasType(type: string, value: unknown): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return false;
  }
}

/**
 * Checks a model's answer against a schema and returns what is wrong, or null. A model can answer in a shape
 * of its own however it was asked, so nothing from it is used before this passes. Unknown keywords are
 * ignored; `additionalProperties: false` is enforced.
 */
export function validateAgainst(schema: JsonSchema, value: unknown, path = "$"): string | null {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => hasType(type, value))) return `${path} must be ${types.join(" or ")}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(", ")}`;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} is too short`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is longer than ${schema.maxLength} characters`;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} item(s)`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} has more than ${schema.maxItems} items`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const problem = validateAgainst(schema.items, value[i], `${path}[${i}]`);
        if (problem) return problem;
      }
    }
  }
  if (hasType("object", value)) {
    const object = value as Record<string, unknown>;
    for (const name of schema.required ?? []) {
      if (!(name in object)) return `${path}.${name} is missing`;
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (name in object) {
        const problem = validateAgainst(child, object[name], `${path}.${name}`);
        if (problem) return problem;
      }
    }
    if (schema.additionalProperties === false) {
      const extra = Object.keys(object).find((name) => !(name in (schema.properties ?? {})));
      if (extra) return `${path}.${extra} isn't expected`;
    }
  }
  return null;
}

const BOUNDS = ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"] as const;

/**
 * The schema as it is sent to a provider: without the size bounds. Structured output modes reject or ignore
 * them, so they are checked here by `validateAgainst` instead, and the prompt states the limits in words.
 */
export function stripBounds(schema: JsonSchema): JsonSchema {
  const copy: JsonSchema = { ...schema };
  for (const key of BOUNDS) delete copy[key];
  if (copy.items) copy.items = stripBounds(copy.items);
  if (copy.properties) {
    copy.properties = Object.fromEntries(Object.entries(copy.properties).map(([name, child]) => [name, stripBounds(child)]));
  }
  return copy;
}

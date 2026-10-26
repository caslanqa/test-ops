import { AiProviderKind } from "@prisma/client";
import { AnthropicProvider } from "./anthropic";
import { OpenAiCompatibleProvider } from "./openai-compatible";

export interface AiGenerateRequest {
  system: string;
  user: string;
  /** Names the answer's shape; letters, digits, "_" and "-" only (it becomes a tool or format name). */
  schemaName: string;
  /** A JSON Schema (draft-07) object schema the answer must fit. */
  schema: object;
}

export interface AiGenerateResult {
  output: unknown;
  usage: { inputTokens: number; outputTokens: number };
}

/** One model call that answers in a given shape. Retrying is the workflow's job, not the provider's. */
export interface AiProvider {
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
}

export interface AiProviderInput {
  provider: AiProviderKind;
  model: string;
  /** OpenAI-compatible: the base URL including /v1. Anthropic: the base URL, or null for the public API. */
  endpoint: string | null;
  credential: string | null;
  maxOutputTokens: number;
  requestTimeoutMs: number;
}

export function createAiProvider(input: AiProviderInput): AiProvider {
  return input.provider === AiProviderKind.ANTHROPIC ? new AnthropicProvider(input) : new OpenAiCompatibleProvider(input);
}

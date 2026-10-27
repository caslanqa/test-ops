import { AiProviderError } from "../provider-error";
import { callProvider, tokenCount } from "./http";
import type { AiGenerateRequest, AiGenerateResult, AiProvider, AiProviderInput } from "./provider";

const PUBLIC_API = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

interface MessagesAnswer {
  content?: { type?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

/**
 * Anthropic's Messages API. The answer's shape is one tool whose input schema is the schema, and the model is
 * forced to call it, so the tool's input is the structured answer.
 */
export class AnthropicProvider implements AiProvider {
  constructor(private readonly input: AiProviderInput) {}

  async generate({ system, user, schemaName, schema }: AiGenerateRequest): Promise<AiGenerateResult> {
    if (!this.input.credential) throw new AiProviderError("Anthropic needs a provider key", false);
    const base = (this.input.endpoint ?? PUBLIC_API).replace(/\/+$/, "");
    const { answer: envelope } = await callProvider(
      new URL(`${base}/v1/messages`),
      {
        model: this.input.model,
        max_tokens: this.input.maxOutputTokens,
        system,
        messages: [{ role: "user", content: user }],
        tools: [{ name: schemaName, description: "Returns the answer in the required shape.", input_schema: schema }],
        tool_choice: { type: "tool", name: schemaName },
      },
      { "x-api-key": this.input.credential, "anthropic-version": API_VERSION },
      { credential: this.input.credential, requestTimeoutMs: this.input.requestTimeoutMs },
    );
    const answer = envelope as MessagesAnswer;

    if (answer?.stop_reason === "max_tokens") {
      throw new AiProviderError("The model ran out of output tokens before it finished; raise the output limit", false);
    }
    const call = answer?.content?.find((block) => block.type === "tool_use" && block.name === schemaName);
    if (!call || typeof call.input !== "object" || call.input === null) {
      throw new AiProviderError("The model didn't return the structured answer", true);
    }
    return {
      output: call.input,
      usage: { inputTokens: tokenCount(answer.usage?.input_tokens), outputTokens: tokenCount(answer.usage?.output_tokens) },
    };
  }
}

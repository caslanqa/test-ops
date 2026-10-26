import { AiProviderError } from "../provider-error";
import { callProvider, tokenCount } from "./http";
import type { AiGenerateRequest, AiGenerateResult, AiProvider, AiProviderInput } from "./provider";

interface ChatCompletion {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

const NO_STRUCTURED_OUTPUT =
  "The server doesn't support structured output (response_format json_schema); use a model and server that do";

/**
 * Any server that speaks OpenAI's chat completions API, including local ones such as Ollama and vLLM. The
 * answer is asked for as a JSON schema (`response_format`), so the server has to support that.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly input: AiProviderInput) {}

  async generate({ system, user, schemaName, schema }: AiGenerateRequest): Promise<AiGenerateResult> {
    if (!this.input.endpoint) throw new AiProviderError("An OpenAI-compatible provider needs an endpoint", false);
    const url = new URL(`${this.input.endpoint.replace(/\/+$/, "")}/chat/completions`);
    const answer = (await callProvider(
      url,
      {
        model: this.input.model,
        max_tokens: this.input.maxOutputTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } },
      },
      // Local servers often need no key.
      this.input.credential ? { authorization: `Bearer ${this.input.credential}` } : {},
      {
        credential: this.input.credential,
        requestTimeoutMs: this.input.requestTimeoutMs,
        explainFailure: (status, body) =>
          (status === 400 || status === 422) && /json_schema|response_format/i.test(body) ? NO_STRUCTURED_OUTPUT : null,
      },
    )) as ChatCompletion;

    const choice = answer?.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new AiProviderError("The model ran out of output tokens before it finished; raise the output limit", false);
    }
    const content = choice?.message?.content;
    if (typeof content !== "string") throw new AiProviderError("The provider's answer has no message content", true);
    let output: unknown;
    try {
      output = JSON.parse(content);
    } catch {
      throw new AiProviderError("The model's answer isn't valid JSON", true);
    }
    return {
      output,
      usage: { inputTokens: tokenCount(answer.usage?.prompt_tokens), outputTokens: tokenCount(answer.usage?.completion_tokens) },
    };
  }
}

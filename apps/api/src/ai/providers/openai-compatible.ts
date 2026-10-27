import { AiProviderError } from "../provider-error";
import { callProvider, tokenCount } from "./http";
import { answerHint, kindOf, parseModelJson } from "./model-json";
import { withRepair, withSchemaInstruction, type AnswerMode } from "./output-mode";
import type { AiGenerateRequest, AiGenerateResult, AiProvider, AiProviderInput } from "./provider";

interface ChatCompletion {
  choices?: {
    message?: { content?: unknown; tool_calls?: { function?: { arguments?: unknown } }[] };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/** What a server that refuses a way of asking is told back, per way. */
const REFUSED: Record<AnswerMode, { pattern: RegExp; message: string } | null> = {
  JSON_SCHEMA: {
    pattern: /json_schema|response_format/i,
    message: "The server doesn't support structured output (response_format json_schema)",
  },
  TOOL_CALL: { pattern: /tool|function/i, message: "The server doesn't support tool calls (tools and tool_choice)" },
  JSON_OBJECT: { pattern: /json_object|response_format/i, message: "The server doesn't support response_format json_object" },
  PROMPT: null,
};

/**
 * The name of the output limit in the request. OpenAI (and Azure OpenAI) deprecate `max_tokens` and reject it for
 * their newer model families; local servers such as Ollama and vLLM only know `max_tokens`.
 */
export function outputLimitParam(endpointHost: string): "max_completion_tokens" | "max_tokens" {
  const host = endpointHost.split(":")[0].toLowerCase();
  return host === "api.openai.com" || host.endsWith(".openai.azure.com") ? "max_completion_tokens" : "max_tokens";
}

/**
 * The request body for a way of asking. JSON_SCHEMA: `response_format` with the schema. TOOL_CALL: the schema as the
 * parameters of one function that the model must call. JSON_OBJECT: `response_format` json_object, with the schema
 * written into the prompt. PROMPT: nothing but the prompt, with the schema in it.
 */
function bodyFor(mode: AnswerMode, { system, user, schemaName, schema, repair }: AiGenerateRequest) {
  const needsSchemaInPrompt = mode === "JSON_OBJECT" || mode === "PROMPT";
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: needsSchemaInPrompt ? withSchemaInstruction(system, schema) : system },
      { role: "user", content: withRepair(user, repair) },
    ],
  };
  if (mode === "JSON_SCHEMA") body.response_format = { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } };
  if (mode === "JSON_OBJECT") body.response_format = { type: "json_object" };
  if (mode === "TOOL_CALL") {
    body.tools = [{ type: "function", function: { name: schemaName, description: "Returns the answer in the required shape.", parameters: schema } }];
    body.tool_choice = { type: "function", function: { name: schemaName } };
  }
  return body;
}

/**
 * Any server that speaks OpenAI's chat completions API, including local ones such as Ollama and vLLM. What a server
 * keeps to differs: some honour `response_format` with a schema, some only function calling, some only json_object,
 * some nothing. The caller picks the way (see output-mode.ts); whatever comes back is read and checked by us.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly input: AiProviderInput) {}

  async generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    if (!this.input.endpoint) throw new AiProviderError("An OpenAI-compatible provider needs an endpoint", false);
    const mode = request.mode ?? "JSON_SCHEMA";
    const url = new URL(`${this.input.endpoint.replace(/\/+$/, "")}/chat/completions`);
    const refused = REFUSED[mode];
    const { answer: envelope, endpointIsPrivate } = await callProvider(
      url,
      { model: this.input.model, [outputLimitParam(url.host)]: this.input.maxOutputTokens, ...bodyFor(mode, request) },
      // Local servers often need no key.
      this.input.credential ? { authorization: `Bearer ${this.input.credential}` } : {},
      {
        credential: this.input.credential,
        requestTimeoutMs: this.input.requestTimeoutMs,
        explainFailure: (status, body) => ((status === 400 || status === 422) && refused?.pattern.test(body) ? refused.message : null),
      },
    );
    const answer = envelope as ChatCompletion;

    const choice = answer?.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new AiProviderError("The model ran out of output tokens before it finished; raise the output limit", false);
    }
    // A tool call carries the answer as the function's arguments; a server that answers in the text instead is read too.
    const toolArguments = choice?.message?.tool_calls?.[0]?.function?.arguments;
    const content = typeof toolArguments === "string" && toolArguments.trim() ? toolArguments : choice?.message?.content;
    if (typeof content !== "string") throw new AiProviderError("The provider's answer has no message content", true, { escalate: true });
    const hint = (text: string) => answerHint(text, endpointIsPrivate, this.input.credential);
    let output: unknown;
    try {
      output = parseModelJson(content);
    } catch {
      throw new AiProviderError(`The model's answer isn't valid JSON${hint(content)}`, true, {
        escalate: true,
        rawAnswer: content,
        problem: "it isn't valid JSON",
      });
    }
    if (typeof output !== "object" || output === null || Array.isArray(output)) {
      throw new AiProviderError(`The model's answer isn't a JSON object (it is ${kindOf(output)})${hint(content)}`, true, {
        escalate: true,
        rawAnswer: content,
        problem: `it is ${kindOf(output)}, not a JSON object`,
      });
    }
    return {
      output,
      usage: { inputTokens: tokenCount(answer.usage?.prompt_tokens), outputTokens: tokenCount(answer.usage?.completion_tokens) },
    };
  }
}

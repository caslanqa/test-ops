export type AiProviderKind = 'ANTHROPIC' | 'OPENAI_COMPATIBLE';

/** Which AI setting a project uses: its own, its workspace's default, or none. */
export type AiSource = 'PROJECT' | 'WORKSPACE' | 'NONE';

export const AI_PROVIDER_LABEL: Record<AiProviderKind, string> = {
  OPENAI_COMPATIBLE: 'OpenAI-compatible (OpenAI, Ollama, vLLM, …)',
  ANTHROPIC: 'Anthropic',
};

/** A setting as the API shows it. The provider key is never part of it, only whether one is saved. */
export interface AiSettingsView {
  id: string;
  scope: 'WORKSPACE' | 'PROJECT';
  enabled: boolean;
  provider: AiProviderKind;
  model: string;
  endpoint: string | null;
  hasCredential: boolean;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxRunsPerUserPerDay: number;
  /** Set by a passing connection test; AI can only be switched on while it is set. */
  testedAt: string | null;
  updatedAt: string;
}

/** What a project admin sees of the workspace default they inherit: no limits, no ids, never the key. */
export interface InheritedAiSettings {
  provider: AiProviderKind;
  model: string;
  endpoint: string | null;
  enabled: boolean;
  hasCredential: boolean;
}

export interface ProjectAiSettings {
  own: AiSettingsView | null;
  inherited: InheritedAiSettings | null;
  source: AiSource;
}

export interface SaveAiSettings {
  provider: AiProviderKind;
  model: string;
  endpoint?: string;
  credential?: string;
  clearCredential?: boolean;
  enabled: boolean;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxRunsPerUserPerDay: number;
}

export interface AiTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** The host a setting sends project data to, for the disclosure; the public API when an Anthropic setting has no endpoint. */
export function aiEndpointHost(provider: AiProviderKind, endpoint: string | null | undefined): string {
  const value = endpoint?.trim();
  if (!value) return provider === 'ANTHROPIC' ? 'api.anthropic.com' : 'the endpoint you enter';
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

import type { RunGuidance } from './guidance';

export type AiProviderKind = 'ANTHROPIC' | 'OPENAI_COMPATIBLE';

/** How an OpenAI-compatible server is asked for a structured answer. */
export type AiOutputMode = 'AUTO' | 'JSON_SCHEMA' | 'TOOL_CALL' | 'JSON_OBJECT' | 'PROMPT';

export const AI_OUTPUT_MODE_LABEL: Record<AiOutputMode, string> = {
  AUTO: 'Automatic',
  JSON_SCHEMA: 'JSON schema',
  TOOL_CALL: 'Tool call',
  JSON_OBJECT: 'JSON object',
  PROMPT: 'Prompt only',
};

export const AI_OUTPUT_MODE_HINT: Record<AiOutputMode, string> = {
  AUTO: 'Tries a JSON schema, then a tool call, then a JSON object, and remembers what works for this server.',
  JSON_SCHEMA: 'response_format with the schema. Servers and gateways often ignore it without saying so.',
  TOOL_CALL: 'The schema as a function the model must call. Works on most gateways that ignore a JSON schema.',
  JSON_OBJECT: 'response_format json_object, with the schema written into the prompt.',
  PROMPT: 'The schema in the prompt alone, for a server with no other way. The answer is still checked and asked for again.',
};

/** Which AI setting a project uses: its own, its workspace's default, or none. */
export type AiSource = 'PROJECT' | 'WORKSPACE' | 'NONE';

/** The most tokens of the team's guidance in one step's prompt: the default, and the range the server accepts. */
export const GUIDANCE_BUDGET = { default: 6000, min: 0, max: 200000 };

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
  /** The most tokens of the team's guidance in one step's prompt; 0 means no limit. */
  guidanceBudgetTokens: number;
  outputMode: AiOutputMode;
  /** What Automatic learned from runs and tests, if anything. */
  learnedMode: AiOutputMode | null;
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
  outputMode: AiOutputMode;
  enabled: boolean;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  maxRunsPerUserPerDay: number;
  guidanceBudgetTokens: number;
  /** The proof of a passing test of exactly these values (see AiTestResult). */
  testProof?: string;
}

export interface AiTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  /** Returned by a passing test of the form's values: saving exactly those values with it counts as tested. */
  proof?: string;
  /** The way of asking that worked (OpenAI-compatible servers). */
  mode?: AiOutputMode;
}

/** The values of the form to test before they are saved. */
export interface TestAiSettings {
  provider: AiProviderKind;
  outputMode?: AiOutputMode;
  model: string;
  endpoint?: string;
  credential?: string;
  clearCredential?: boolean;
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

export type AiRunStatus = 'QUEUED' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** The runs that are still going or waiting for someone: the Requirements page links to them instead of starting another. */
export const OPEN_RUN_STATUSES: readonly AiRunStatus[] = ['QUEUED', 'RUNNING', 'AWAITING_APPROVAL'];

export interface AiRunStep {
  name: string;
  skillVersion: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  attempt: number;
  /** How the answer was asked for on this try. */
  mode: AiOutputMode | null;
  /** Estimated tokens of the team's guidance in this step's prompt; null when there was none. */
  guidanceTokens: number | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface DraftStep {
  action: string;
  expectedResult?: string;
}

export type DraftKind = 'positive' | 'negative' | 'boundary' | 'error';

/** A test case the model proposes; a person edits it before approving. */
export interface CaseDraft {
  title: string;
  preconditions?: string;
  steps?: DraftStep[];
  priority?: string;
  type?: string;
  kind: DraftKind;
}

export interface AiReview {
  summary: string;
  acceptanceCriteria: string[];
  findings: { kind: string; severity: 'low' | 'medium' | 'high'; text: string }[];
}

export interface AiAudit {
  coverage: { criterion: number; caseIndexes: number[] }[];
  uncovered: number[];
  duplicates: { caseIndex: number; existingCaseId: string; reason: string }[];
  revisionNeeded: boolean;
  notes: string;
}

export interface AiRunSummary {
  id: string;
  type: 'REQUIREMENT_TO_CASES';
  projectId: string;
  createdById: string;
  status: AiRunStatus;
  input: { requirementId: string; extraContext: string | null };
  providerSnapshot: { provider: AiProviderKind; model: string; endpointHost: string; source: AiSource; settingsId: string };
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AiRun extends AiRunSummary {
  /** The guidance the run was sent; null for a run from before guidance existed. */
  guidance: RunGuidance | null;
  result: { review: AiReview; drafts: CaseDraft[]; audit: AiAudit; createdCaseIds?: string[] } | null;
  steps: AiRunStep[];
}

/** What each step of the workflow is doing, in words. */
export const AI_STEP_LABEL: Record<string, string> = {
  REVIEW: 'Reading the requirement',
  DESIGN: 'Drafting test cases',
  AUDIT: 'Checking coverage',
  REVISE: 'Revising the drafts',
  AUDIT_REVISED: 'Checking coverage again',
};

/** The one line that says where a run is; it sits in a live region, so a change is announced. */
export function aiRunStatusText(run: AiRun): string {
  const drafts = run.result?.drafts.length ?? 0;
  const created = run.result?.createdCaseIds?.length ?? 0;
  switch (run.status) {
    case 'QUEUED':
      return 'Waiting to start…';
    case 'RUNNING': {
      const last = run.steps[run.steps.length - 1];
      return `Working: ${last ? (AI_STEP_LABEL[last.name] ?? last.name) : 'starting'}…`;
    }
    case 'AWAITING_APPROVAL':
      return `Ready for your review: ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}.`;
    case 'COMPLETED':
      return `Done: ${created} test ${created === 1 ? 'case' : 'cases'} created.`;
    case 'FAILED':
      return 'The run failed.';
    case 'CANCELLED':
      return 'The run was cancelled.';
  }
}

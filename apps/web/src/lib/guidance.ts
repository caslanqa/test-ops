import { api } from '../api/client';

export type GuidanceKind = 'CASE_CONTENT' | 'AUTOMATION_CODE' | 'TEAM_RULE';
export type GuidanceStep = 'REVIEW' | 'DESIGN' | 'AUDIT' | 'CODEGEN';

export const GUIDANCE_KIND_LABEL: Record<GuidanceKind, string> = {
  CASE_CONTENT: 'Case content',
  AUTOMATION_CODE: 'Automation code',
  TEAM_RULE: 'Team rule',
};

export const GUIDANCE_STEP_LABEL: Record<GuidanceStep, string> = {
  REVIEW: 'Requirement review',
  DESIGN: 'Case design',
  AUDIT: 'Coverage audit',
  CODEGEN: 'Code generation',
};

export const GUIDANCE_STEPS: readonly GuidanceStep[] = ['REVIEW', 'DESIGN', 'AUDIT', 'CODEGEN'];

/** The sizes the server keeps to. */
export const GUIDANCE_LIMITS = { title: 200, summary: 500, body: 20000, priority: { min: 0, max: 1000, default: 500 } };

/** What a guidance costs in a prompt, as the server estimates it: a token per four characters, plus 30. */
export const estimateGuidanceTokens = (body: string): number => Math.ceil(body.length / 4) + 30;

export const stepsText = (steps: readonly GuidanceStep[]): string => steps.map((step) => GUIDANCE_STEP_LABEL[step]).join(', ');

export interface GuidanceView {
  id: string;
  scope: 'WORKSPACE' | 'PROJECT';
  title: string;
  summary: string | null;
  body: string;
  kind: GuidanceKind;
  steps: GuidanceStep[];
  priority: number;
  enabled: boolean;
  version: number;
  sourceKind: 'WRITTEN' | 'UPLOADED';
  sourceName: string | null;
  sourceUrl: string | null;
  license: string | null;
  /** What it adds to a prompt, as estimated for the budget. */
  estimatedTokens: number;
  updatedAt: string;
}

/** A workspace guidance seen from a project: `enabledHere` says whether it applies to that project. */
export type InheritedGuidanceView = GuidanceView & { enabledHere: boolean };

/** A built-in pack that ships with TestOps, with whether it is on for the workspace or project. */
export interface BuiltinGuidanceView {
  key: string;
  title: string;
  summary: string;
  kind: GuidanceKind;
  steps: GuidanceStep[];
  priority: number;
  version: number;
  license: string;
  origin: string;
  body: string;
  estimatedTokens: number;
  enabled: boolean;
  /** Projects only: the project has its own switch for the pack, rather than following its workspace. */
  setByProject?: boolean;
}

export interface GuidanceList {
  own: GuidanceView[];
  /** Projects only: the guidance of the project's workspace. */
  inherited?: InheritedGuidanceView[];
  builtin: BuiltinGuidanceView[];
}

export interface GuidanceVersion {
  version: number;
  title: string;
  summary: string | null;
  body: string;
  kind: GuidanceKind;
  steps: GuidanceStep[];
  priority: number;
  createdAt: string;
}

/** What a markdown file would make as a guidance (nothing is saved until the dialog is). */
export interface ImportPreview {
  title: string;
  summary: string | null;
  body: string;
  sourceName: string;
  suggestedKind: GuidanceKind;
  estimatedTokens: number;
}

/** What a step would be sent: the answer of the preview and effective routes. */
export interface GuidanceAnswer {
  step: GuidanceStep;
  selection: 'EFFECTIVE' | 'NONE' | 'LIST';
  budgetTokens: number;
  usedTokens: number;
  used: { ref: string; scope: 'BUILTIN' | 'WORKSPACE' | 'PROJECT'; title: string; version: number; priority: number; tokens: number; body: string }[];
  dropped: { ref: string; title: string; tokens: number }[];
}

/** What a person picks before drafting: what applies now, nothing, or named guidance. */
export type RunGuidanceChoice = { mode: 'EFFECTIVE' } | { mode: 'NONE' } | { mode: 'LIST'; ids: string[] };

/** What to send for a choice: a list with nothing in it is the same as none. */
export function choiceToRequest(choice: RunGuidanceChoice): { mode: 'EFFECTIVE' | 'NONE' | 'LIST'; ids?: string[] } {
  if (choice.mode === 'LIST') return choice.ids.length === 0 ? { mode: 'NONE' } : { mode: 'LIST', ids: choice.ids };
  return { mode: choice.mode };
}

/** What a run keeps of the guidance it was sent: titles, versions and sizes, never the text. */
export interface RunGuidance {
  mode: 'EFFECTIVE' | 'NONE' | 'LIST';
  budgetTokens: number;
  items: Record<string, { scope: 'BUILTIN' | 'WORKSPACE' | 'PROJECT'; title: string; version: number; steps: GuidanceStep[]; tokens: number }>;
  perStep: Record<'REVIEW' | 'DESIGN' | 'AUDIT', string[]>;
  dropped: { step: 'REVIEW' | 'DESIGN' | 'AUDIT'; ref: string; title: string; tokens: number }[];
}

/** One guidance that applies to a project now. */
export interface AppliedGuidance {
  ref: string;
  title: string;
}

/**
 * What applies to a project now across the steps of a run, each guidance once, with what the budget left out:
 * the list a person chooses from before drafting. Any member of the project can read it.
 */
export async function loadAppliedGuidance(projectId: string): Promise<AppliedGuidance[]> {
  const steps: GuidanceStep[] = ['REVIEW', 'DESIGN', 'AUDIT'];
  const answers = await Promise.all(steps.map((step) => api.get<GuidanceAnswer>(`/projects/${projectId}/ai/guidance/effective?step=${step}`)));
  const seen = new Map<string, AppliedGuidance>();
  for (const answer of answers) {
    for (const item of [...answer.used, ...answer.dropped]) if (!seen.has(item.ref)) seen.set(item.ref, { ref: item.ref, title: item.title });
  }
  return [...seen.values()];
}

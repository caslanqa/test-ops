export interface CaseStep {
  action: string;
  expectedResult?: string;
}

export type DraftKind = "positive" | "negative" | "boundary" | "error";

/** A test case the model proposes; the fields of CreateTestCaseDto plus what kind of case it is. */
export interface CaseDraft {
  title: string;
  preconditions?: string;
  steps: CaseStep[];
  priority: string;
  type: string;
  kind: DraftKind;
}

export interface ReviewFinding {
  kind: "clarity" | "testability" | "acceptance-criteria" | "risk" | "question";
  severity: "low" | "medium" | "high";
  text: string;
}

export interface Review {
  summary: string;
  acceptanceCriteria: string[];
  findings: ReviewFinding[];
}

export interface Audit {
  coverage: { criterion: number; caseIndexes: number[] }[];
  uncovered: number[];
  duplicates: { caseIndex: number; existingCaseId: string; reason: string }[];
  revisionNeeded: boolean;
  notes: string;
}

/** What a run sends to the provider about the project; see AiRunExecutor.loadContext. */
export interface RunContext {
  requirement: { title: string; description: string | null };
  extraContext: string | null;
  /** The cases already linked to the requirement. */
  linkedCases: { title: string; steps: CaseStep[] }[];
  /** Up to 200 other cases of the project, for duplicate detection. */
  otherCases: { id: string; title: string }[];
}

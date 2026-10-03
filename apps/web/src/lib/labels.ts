// UI display labels for the API enum values (see apps/api/prisma/schema.prisma).

export const PRIORITY_LABEL = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
} as const;
export type CasePriority = keyof typeof PRIORITY_LABEL;

/** Number of filled bars in the priority indicator (1–4). */
export const PRIORITY_LEVEL: Record<CasePriority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const CASE_SEVERITY_LABEL = {
  MINOR: 'Minor',
  NORMAL: 'Normal',
  MAJOR: 'Major',
  BLOCKER: 'Blocker',
} as const;
export type CaseSeverity = keyof typeof CASE_SEVERITY_LABEL;

export const CASE_TYPE_LABEL = {
  FUNCTIONAL: 'Functional',
  SMOKE: 'Smoke',
  REGRESSION: 'Regression',
  SECURITY: 'Security',
  PERFORMANCE: 'Performance',
  OTHER: 'Other',
} as const;
export type CaseType = keyof typeof CASE_TYPE_LABEL;

export const AUTOMATION_LABEL = {
  MANUAL: 'Manual',
  TO_BE_AUTOMATED: 'To be automated',
  AUTOMATED: 'Automated',
} as const;
export type AutomationStatus = keyof typeof AUTOMATION_LABEL;

export const RUN_STATUS_LABEL = {
  OPEN: 'Open',
  COMPLETED: 'Completed',
} as const;

export const RUN_SOURCE_LABEL = {
  MANUAL: 'Manual',
  CI: 'CI',
} as const;

export const DEFECT_STATUS_LABEL = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
} as const;

export const DEFECT_SEVERITY_LABEL = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
} as const;

/** Shows the raw value if an unknown enum value arrives, so the UI never stays blank. */
export function labelOf<T extends Record<string, string>>(
  labels: T,
  value: string | null | undefined,
): string {
  if (!value) return '—';
  return (labels as Record<string, string>)[value] ?? value;
}

export const PROJECT_ROLE_LABEL = {
  ADMIN: 'Admin',
  TESTER: 'Tester',
  AUTOMATION: 'Automation',
  VIEWER: 'Viewer',
} as const;
export type ProjectRole = keyof typeof PROJECT_ROLE_LABEL;

/** Descriptions shown in the role picker (matching the server's permission rules). */
export const PROJECT_ROLE_DESCRIPTION: Record<ProjectRole, string> = {
  ADMIN: "Can do everything, including managing project members and their roles.",
  TESTER: "Creates cases, suites, requirements and plans; starts runs and records results.",
  AUTOMATION: "Starts runs and submits results (from CI with an API token); can't change the repository.",
  VIEWER: "Can see everything but can't change anything.",
};

export const WORKSPACE_ROLE_LABEL = {
  ADMIN: 'Admin',
  MEMBER: 'Member',
} as const;
export type WorkspaceRole = keyof typeof WORKSPACE_ROLE_LABEL;

export const WORKSPACE_ROLE_DESCRIPTION: Record<WorkspaceRole, string> = {
  ADMIN: 'Creates projects, manages workspace members and has admin rights in every project.',
  MEMBER: "Sees only the projects they're added to, with the role they have there.",
};

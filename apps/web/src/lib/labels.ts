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
  ADMIN: 'Project admin',
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

/**
 * The five user types of the role ladder, top first. "Workspace admin" is the workspace role ADMIN; the
 * other four are project roles, held together with the workspace role MEMBER (design-doc.md, section 3).
 */
export const USER_TYPES = ['WORKSPACE_ADMIN', 'PROJECT_ADMIN', 'TESTER', 'AUTOMATION', 'VIEWER'] as const;
export type UserType = (typeof USER_TYPES)[number];

export const USER_TYPE_LABEL: Record<UserType, string> = {
  WORKSPACE_ADMIN: 'Workspace admin',
  PROJECT_ADMIN: PROJECT_ROLE_LABEL.ADMIN,
  TESTER: PROJECT_ROLE_LABEL.TESTER,
  AUTOMATION: PROJECT_ROLE_LABEL.AUTOMATION,
  VIEWER: PROJECT_ROLE_LABEL.VIEWER,
};

export const USER_TYPE_DESCRIPTION: Record<UserType, string> = {
  WORKSPACE_ADMIN: WORKSPACE_ROLE_DESCRIPTION.ADMIN,
  PROJECT_ADMIN: PROJECT_ROLE_DESCRIPTION.ADMIN,
  TESTER: PROJECT_ROLE_DESCRIPTION.TESTER,
  AUTOMATION: PROJECT_ROLE_DESCRIPTION.AUTOMATION,
  VIEWER: PROJECT_ROLE_DESCRIPTION.VIEWER,
};

const PROJECT_ROLE_OF_TYPE: Record<Exclude<UserType, 'WORKSPACE_ADMIN'>, ProjectRole> = {
  PROJECT_ADMIN: 'ADMIN',
  TESTER: 'TESTER',
  AUTOMATION: 'AUTOMATION',
  VIEWER: 'VIEWER',
};

/** The roles an invitation of this type carries: a workspace admin needs no project; the others join as members. */
export function invitationRoles(
  type: UserType,
  projectId: string,
): { role: WorkspaceRole; projectId?: string; projectRole?: ProjectRole } {
  if (type === 'WORKSPACE_ADMIN') return { role: 'ADMIN' };
  return { role: 'MEMBER', projectId, projectRole: PROJECT_ROLE_OF_TYPE[type] };
}

/** What an invitation gives, such as "Tester in Demo Project". Older invitations name only the workspace role. */
export function invitationTypeLabel(invitation: {
  role: string;
  projectRole?: string | null;
  project?: { name: string } | null;
}): string {
  if (invitation.role === 'ADMIN') return USER_TYPE_LABEL.WORKSPACE_ADMIN;
  if (invitation.projectRole && invitation.project) {
    return `${labelOf(PROJECT_ROLE_LABEL, invitation.projectRole)} in ${invitation.project.name}`;
  }
  return labelOf(WORKSPACE_ROLE_LABEL, invitation.role);
}

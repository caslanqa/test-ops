import { Bug, ClipboardList, FolderTree, ListChecks, PlayCircle, Plug, Sparkles, Users } from 'lucide-react';

/** Who sees the sections that are not for everyone (a workspace admin counts as ADMIN); App.tsx uses the same lists for the routes. */
export const MEMBERS_ROLES = ['ADMIN'] as const;
export const INTEGRATIONS_ROLES = ['ADMIN', 'AUTOMATION'] as const;
export const AI_ROLES = ['ADMIN'] as const;

/** In-project sections; the order follows the usual test workflow: design → plan → run → track. */
export const PROJECT_SECTIONS = [
  { path: 'cases', label: 'Test cases', icon: FolderTree },
  { path: 'requirements', label: 'Requirements', icon: ListChecks },
  { path: 'plans', label: 'Plans', icon: ClipboardList },
  { path: 'runs', label: 'Runs', icon: PlayCircle },
  { path: 'defects', label: 'Defects', icon: Bug },
  // Setting up the project is for project admins (members) and also for Automation users (integrations: how
  // CI reports to the project). The other roles don't see these sections, and App.tsx sends them away from
  // the addresses. A workspace admin counts as ADMIN.
  { path: 'members', label: 'Members', icon: Users, roles: MEMBERS_ROLES },
  { path: 'integrations', label: 'Integrations', icon: Plug, roles: INTEGRATIONS_ROLES },
  // Where the AI provider is defined: it says where project data may be sent, so it is for project admins only.
  { path: 'ai', label: 'AI', icon: Sparkles, roles: AI_ROLES },
] as const;

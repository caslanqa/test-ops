import { Bug, ClipboardList, FolderTree, ListChecks, PlayCircle, Plug, Users } from 'lucide-react';

/** In-project sections; the order follows the usual test workflow: design → plan → run → track. */
export const PROJECT_SECTIONS = [
  { path: 'cases', label: 'Test cases', icon: FolderTree },
  { path: 'requirements', label: 'Requirements', icon: ListChecks },
  { path: 'plans', label: 'Plans', icon: ClipboardList },
  { path: 'runs', label: 'Runs', icon: PlayCircle },
  { path: 'defects', label: 'Defects', icon: Bug },
  // Setting up the project (who is in it, the webhook with its credentials) is for project admins; the
  // other roles don't see these sections, and App.tsx sends them away from the addresses.
  { path: 'members', label: 'Members', icon: Users, adminOnly: true },
  { path: 'integrations', label: 'Integrations', icon: Plug, adminOnly: true },
] as const;

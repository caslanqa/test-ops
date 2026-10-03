import { Bug, ClipboardList, FolderTree, ListChecks, PlayCircle, Users } from 'lucide-react';

/** In-project sections; the order follows the Qase workflow: design → plan → run → track. */
export const PROJECT_SECTIONS = [
  { path: 'cases', label: 'Test cases', icon: FolderTree },
  { path: 'requirements', label: 'Requirements', icon: ListChecks },
  { path: 'plans', label: 'Plans', icon: ClipboardList },
  { path: 'runs', label: 'Runs', icon: PlayCircle },
  { path: 'defects', label: 'Defects', icon: Bug },
  { path: 'members', label: 'Members', icon: Users },
] as const;

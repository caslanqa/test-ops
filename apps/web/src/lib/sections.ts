import { Bug, ClipboardList, FolderTree, ListChecks, PlayCircle, Users } from 'lucide-react';

/** Proje içi bölümler; sıra Qase'teki iş akışını izler: tasarla → planla → koş → takip et. */
export const PROJECT_SECTIONS = [
  { path: 'cases', label: 'Test cases', icon: FolderTree },
  { path: 'requirements', label: 'Requirements', icon: ListChecks },
  { path: 'plans', label: 'Plans', icon: ClipboardList },
  { path: 'runs', label: 'Runs', icon: PlayCircle },
  { path: 'defects', label: 'Defects', icon: Bug },
  { path: 'members', label: 'Members', icon: Users },
] as const;

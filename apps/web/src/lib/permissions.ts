import type { ProjectRole } from './labels';
import { useProjectInfo } from './projectInfo';

export interface ProjectPermissions {
  role: ProjectRole | undefined;
  /** Case, suite, requirement ve plan oluşturma/düzenleme. */
  editRepository: boolean;
  /** Run başlatma, sonuç girme, defect açma. */
  execute: boolean;
  /** Proje üyelerini ve rollerini yönetme. */
  manageMembers: boolean;
}

/**
 * Sunucudaki WRITE_ROLES kurallarının arayüzdeki karşılığı: kullanıcının yapamayacağı
 * eylemler gösterilmez. Yetki kontrolü her zaman sunucuda da yapılır; bu yalnızca
 * kullanıcının 403 alacağı butonlarla karşılaşmamasını sağlar.
 */
export function projectPermissions(role: ProjectRole | undefined): ProjectPermissions {
  return {
    role,
    editRepository: role === 'ADMIN' || role === 'TESTER',
    execute: role === 'ADMIN' || role === 'TESTER' || role === 'AUTOMATION',
    manageMembers: role === 'ADMIN',
  };
}

export function useProjectPermissions(projectId: string | undefined): ProjectPermissions {
  const { data } = useProjectInfo(projectId);
  return projectPermissions(data?.project.currentUserRole);
}

import { api } from '../api/client';
import { useResource } from './useResource';

/** Whether self-registration is enabled (SELF_REGISTRATION on the server). */
export function useAuthConfig() {
  return useResource(() => api.get<{ selfRegistration: boolean }>('/auth/config'), []);
}

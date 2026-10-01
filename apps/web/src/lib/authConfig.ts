import { api } from '../api/client';
import { useResource } from './useResource';

/** Kendi kendine kaydın açık olup olmadığı (sunucudaki SELF_REGISTRATION). */
export function useAuthConfig() {
  return useResource(() => api.get<{ selfRegistration: boolean }>('/auth/config'), []);
}

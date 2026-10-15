import { api } from '../api/client';
import { useResource } from './useResource';

export interface AuthConfig {
  /** Whether self-registration is enabled (SELF_REGISTRATION on the server). */
  selfRegistration: boolean;
  /** The running version, e.g. "0.19.0", or "dev" for a local build. */
  version: string;
}

export function useAuthConfig() {
  return useResource(() => api.get<AuthConfig>('/auth/config'), []);
}

/** A version for people: "v0.19.0", or "Development build" for a local build. */
export function versionLabel(version: string): string {
  return version === 'dev' ? 'Development build' : `v${version}`;
}

import { useAuthConfig, versionLabel } from '../lib/authConfig';

/** The running TestOps version, e.g. "TestOps v0.19.0"; nothing while it loads or if it can't be read. */
export function AppVersion({ className }: { className: string }) {
  const { data } = useAuthConfig();
  if (!data?.version) return null;
  return <p className={className}>TestOps {versionLabel(data.version)}</p>;
}

import type { AiSettings } from "@prisma/client";
import type { AiSource } from "./ai-settings.service";

/**
 * Which setting a run was started with, kept on the run and shown to people ("Sent to host (model)"). Never the
 * key. `endpointHost` includes the port: a model on another port is another destination.
 */
export type ProviderSnapshot = {
  provider: string;
  model: string;
  endpointHost: string;
  source: AiSource;
  settingsId: string;
};

/** The host project data goes to under a setting; Anthropic without an endpoint means its public API. */
export function endpointHostOf(settings: AiSettings): string {
  return settings.endpoint ? new URL(settings.endpoint).host : "api.anthropic.com";
}

export function snapshotOf(source: AiSource, settings: AiSettings): ProviderSnapshot {
  return {
    provider: settings.provider,
    model: settings.model,
    endpointHost: endpointHostOf(settings),
    source,
    settingsId: settings.id,
  };
}

/**
 * Whether the setting a run would use now is no longer the one it was started with: another row (a project
 * override was made, or the default was removed and made again), or another provider, model or host. A key or a
 * limit that changed on the same setting is not a change of destination. Such a run is failed instead of sent on,
 * so project data never goes somewhere the run page didn't say.
 */
export function settingChanged(snapshot: unknown, settings: AiSettings): boolean {
  const before = (snapshot ?? {}) as Partial<ProviderSnapshot>;
  return (
    before.settingsId !== settings.id ||
    before.provider !== settings.provider ||
    before.model !== settings.model ||
    before.endpointHost !== endpointHostOf(settings)
  );
}

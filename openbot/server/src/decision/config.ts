/**
 * Where decisions are answered.
 *
 * Deliberately independent of the main chat model. `mercury-3` is the compatibility path for a
 * deployment that has the Inception key but no separate decision endpoint yet; `opendecider` and
 * `laya` are the local paths; `mercury-decide` is the hosted typed-decision API and uses its own
 * key. Nothing here is allowed to fall back to the main model silently: an unset provider means
 * the decision features are off, and every caller must keep working without them.
 */

import type { DecisionClient } from "./types";

export type DecisionProvider =
  | "mercury-3"
  | "mercury-decide"
  | "opendecider"
  | "laya";

export type DecisionConfig = {
  provider: DecisionProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  toolThreshold: number;
  safetyThreshold: number;
  routingThreshold: number;
  triageThreshold: number;
  datasetLogPath?: string;
};

const PROVIDERS = new Set<DecisionProvider>([
  "mercury-3",
  "mercury-decide",
  "opendecider",
  "laya",
]);

function text(
  environment: Record<string, string | undefined>,
  name: string,
): string | undefined {
  return environment[name]?.trim() || undefined;
}

function numberFrom(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = text(environment, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got "${raw}".`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Read the decision configuration, or return undefined when no provider was named.
 *
 * A provider that was named but cannot be reached is a boot error rather than a silent downgrade.
 * The calls that depend on this are the ones that decide which tools are offered and whether an
 * action is safe, and a deployment that thinks it configured a decision model must not discover
 * otherwise on the first dangerous action.
 */
export function decisionConfigFromEnvironment(
  environment: Record<string, string | undefined>,
): DecisionConfig | undefined {
  const rawProvider = text(environment, "DECISION_PROVIDER")?.toLowerCase();
  if (rawProvider === undefined) return undefined;
  if (!PROVIDERS.has(rawProvider as DecisionProvider)) {
    throw new Error(
      `DECISION_PROVIDER must be one of ${[...PROVIDERS].join(", ")}, got "${rawProvider}".`,
    );
  }
  const provider = rawProvider as DecisionProvider;
  const datasetLogPath = text(environment, "DECISION_DATASET_LOG_PATH");

  if (provider === "mercury-3") {
    const apiKey =
      text(environment, "DECISION_API_KEY") ??
      text(environment, "OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error(
        "DECISION_PROVIDER=mercury-3 needs DECISION_API_KEY or OPENAI_API_KEY.",
      );
    }
    return {
      provider,
      baseUrl: normalizeBaseUrl(
        text(environment, "DECISION_BASE_URL") ??
          text(environment, "OPENAI_BASE_URL") ??
          "https://api.inceptionlabs.ai/v1",
      ),
      model: text(environment, "DECISION_MODEL") ?? "mercury-3",
      apiKey,
      timeoutMs: numberFrom(environment, "DECISION_TIMEOUT_MS", 8_000),
      toolThreshold: numberFrom(environment, "DECISION_TOOL_THRESHOLD", 0.35),
      safetyThreshold: numberFrom(
        environment,
        "DECISION_SAFETY_THRESHOLD",
        0.5,
      ),
      routingThreshold: numberFrom(
        environment,
        "DECISION_ROUTING_THRESHOLD",
        0.6,
      ),
      triageThreshold: numberFrom(
        environment,
        "DECISION_TRIAGE_THRESHOLD",
        0.7,
      ),
      ...(datasetLogPath ? { datasetLogPath } : {}),
    };
  }

  if (provider === "mercury-decide") {
    /*
     * Inception's own examples pass the same bearer token as `INCEPTION_API_KEY`. Keep
     * DECISION_API_KEY as the explicit deployment name, but accept the provider-native variable so
     * a local `.env` copied from the API documentation works without a second alias.
     */
    const apiKey =
      text(environment, "DECISION_API_KEY") ??
      text(environment, "INCEPTION_API_KEY");
    if (!apiKey) {
      throw new Error(
        "DECISION_PROVIDER=mercury-decide needs DECISION_API_KEY or INCEPTION_API_KEY, which is separate from OPENAI_API_KEY.",
      );
    }
    return {
      provider,
      baseUrl: normalizeBaseUrl(
        text(environment, "DECISION_BASE_URL") ??
          "https://api.inceptionlabs.ai/v1",
      ),
      model: text(environment, "DECISION_MODEL") ?? "mercury-decide",
      apiKey,
      timeoutMs: numberFrom(environment, "DECISION_TIMEOUT_MS", 8_000),
      toolThreshold: numberFrom(environment, "DECISION_TOOL_THRESHOLD", 0.35),
      safetyThreshold: numberFrom(
        environment,
        "DECISION_SAFETY_THRESHOLD",
        0.5,
      ),
      routingThreshold: numberFrom(
        environment,
        "DECISION_ROUTING_THRESHOLD",
        0.6,
      ),
      triageThreshold: numberFrom(
        environment,
        "DECISION_TRIAGE_THRESHOLD",
        0.7,
      ),
      ...(datasetLogPath ? { datasetLogPath } : {}),
    };
  }

  const defaultModel =
    provider === "opendecider" ? "opendecider-nano" : "laya";
  const apiKey =
    text(environment, "DECISION_API_KEY") ??
    text(environment, "OPENDECIDER_API_KEY") ??
    text(environment, "LAYA_API_KEY") ??
    "";

  return {
    provider,
    baseUrl: normalizeBaseUrl(
      text(environment, "DECISION_BASE_URL") ?? "http://localhost:8000",
    ),
    model: text(environment, "DECISION_MODEL") ?? defaultModel,
    apiKey,
    timeoutMs: numberFrom(environment, "DECISION_TIMEOUT_MS", 5_000),
    toolThreshold: numberFrom(environment, "DECISION_TOOL_THRESHOLD", 0.35),
    safetyThreshold: numberFrom(environment, "DECISION_SAFETY_THRESHOLD", 0.5),
    routingThreshold: numberFrom(
      environment,
      "DECISION_ROUTING_THRESHOLD",
      0.6,
    ),
    triageThreshold: numberFrom(environment, "DECISION_TRIAGE_THRESHOLD", 0.7),
    ...(datasetLogPath ? { datasetLogPath } : {}),
  };
}

export type { DecisionClient };

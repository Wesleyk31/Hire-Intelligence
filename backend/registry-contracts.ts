import { createHash } from "node:crypto";

export type RegistrySource = {
  key: string;
  endpoint: string;
  provenance: string;
  method: string;
  name?: string;
  owner?: string;
  licence?: string;
  territory?: string;
  enabled?: boolean;
  disableReason?: string;
  registryMode?: "HISTORICAL_ONLY";
};

/** Inventory contract, not a substitute for a publisher's reviewed reuse terms. */
export function buildSourceContract(
  source: RegistrySource,
  mode: "REGISTRY" | "HISTORICAL_ONLY" = source.registryMode || "REGISTRY",
) {
  const content = {
    schemaVersion: 1 as const,
    key: source.key,
    name: source.name || source.key,
    owningAgency: source.owner || "UNKNOWN",
    territory: source.territory || "UNKNOWN",
    method: source.method,
    endpoint: source.endpoint,
    provenance: source.provenance,
    resourceVersion: "UNVERIFIED" as const,
    attribution: {
      agency: source.owner || "UNKNOWN",
      sourceUrl: source.provenance,
      licenceLabel: source.licence || "UNKNOWN",
      verification: "REVIEW_REQUIRED" as const,
    },
    rights: {
      status:
        !source.licence || /^unknown$/i.test(source.licence)
          ? ("UNKNOWN" as const)
          : ("REGISTERED_LABEL_UNREVIEWED" as const),
      reviewedAt: null,
      termsUrl: null,
    },
    allowedUses: {
      commercial: "REVIEW_REQUIRED" as const,
      redistribution: "REVIEW_REQUIRED" as const,
      activationByContract: false as const,
    },
    cadence: { publisher: "UNKNOWN" as const, freshnessWindowHours: null },
    dates: {
      retrievalField: "observedAt",
      sourceField: "sourceObservedAt",
      eventSemantics: "UNVERIFIED" as const,
    },
    activation:
      source.enabled === false
        ? ("DISABLED" as const)
        : mode === "HISTORICAL_ONLY"
          ? ("HISTORICAL_ONLY" as const)
          : ("ENABLED_IN_EXISTING_REGISTRY" as const),
    activationReason:
      source.disableReason ||
      (mode === "HISTORICAL_ONLY"
        ? "Historical collection only"
        : "Existing configuration; this contract does not approve reuse or change activation"),
  };
  return {
    ...content,
    version: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
  };
}
export type RegistryContract = ReturnType<typeof buildSourceContract>;

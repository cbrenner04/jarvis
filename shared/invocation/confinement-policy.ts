/** Vendor-agnostic confinement an invocation runs under; each adapter translates it to its own flags. */
export const CONFINEMENT_POLICIES = ["sandbox", "unrestricted"] as const;

export type ConfinementPolicy = (typeof CONFINEMENT_POLICIES)[number];

export const DEFAULT_CONFINEMENT_POLICY: ConfinementPolicy = "unrestricted";

/**
 * Vendor mechanism a binding applied for its policy: `none` when the policy adds nothing beyond the
 * adapter's standing flags (`unrestricted`), `refused` when the vendor has no honest flag for it.
 */
export type ConfinementMechanism = "codex-workspace-write" | "codex-read-only" | "none" | "refused";

const REFUSAL_MARKER = "confinement refusal:";

/** Operator-facing refusal text: vendor, policy, and the config keys that select the policy. */
export function confinementRefusalMessage(vendor: string, policy: ConfinementPolicy): string {
  return `${REFUSAL_MARKER} agent '${vendor}' has no flag honoring confinementPolicy '${policy}'; binding refused before spawn. Set confinementPolicy (machine config) or projects.<projectKey>.overrides.confinementPolicy to a policy every agent in the order supports, or drop '${vendor}' from the order.`;
}

/** True for text carrying a `confinementRefusalMessage` (survives a stderr-tail slice that keeps the marker). */
export function isConfinementRefusalMessage(text: string | undefined): boolean {
  return text?.includes(REFUSAL_MARKER) === true;
}

/** Raised by a binding whose vendor cannot honor the requested policy; thrown before any subprocess spawn. */
export class ConfinementRefusalError extends Error {
  readonly vendor: string;
  readonly policy: ConfinementPolicy;

  constructor(vendor: string, policy: ConfinementPolicy) {
    super(confinementRefusalMessage(vendor, policy));
    this.name = "ConfinementRefusalError";
    this.vendor = vendor;
    this.policy = policy;
  }
}

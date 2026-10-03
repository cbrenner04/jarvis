/** Vendor-agnostic confinement an invocation runs under; each adapter translates it to its own flags. */
export const CONFINEMENT_POLICIES = ["sandbox", "unrestricted"] as const;

export type ConfinementPolicy = (typeof CONFINEMENT_POLICIES)[number];

export const DEFAULT_CONFINEMENT_POLICY: ConfinementPolicy = "unrestricted";

/**
 * Vendor mechanism a binding applied for its policy: `none` when the policy adds nothing beyond the
 * adapter's standing flags (`unrestricted`), `refused` when the vendor has no honest flag for it.
 */
export type ConfinementMechanism = "codex-workspace-write" | "none" | "refused";

/** Raised by a binding whose vendor cannot honor the requested policy; thrown before any subprocess spawn. */
export class ConfinementRefusalError extends Error {
  readonly vendor: string;
  readonly policy: ConfinementPolicy;

  constructor(vendor: string, policy: ConfinementPolicy) {
    super(`agent '${vendor}' has no confinement flag honoring policy '${policy}'; binding refused`);
    this.name = "ConfinementRefusalError";
    this.vendor = vendor;
    this.policy = policy;
  }
}

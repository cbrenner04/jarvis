/** Stderr prefix for immutable-copy overreach recovery notices. */
export const IMMUTABLE_COPY_OVERREACH_NOTICE_PREFIX = "review: reverted immutable-copy overreach:";

/** One registered immutable-copy path with its pre-actuator snapshot bytes. */
export type ImmutableCopyEntry = {
  relativePath: string;
  snapshot: string;
  /** When false, drift on this path blocks recovery (caller-defined, e.g. invalid blocker composite). */
  isRecoverableDrift?: ((snapshot: string, current: string) => boolean) | undefined;
};

/** Gate result shape shared by plan review and future patch validation. */
export type ImmutableCopyValidationResult = {
  valid: boolean;
  error: string | null;
  blocker?: string | undefined;
};

export type RecoverImmutableCopyOverreachOpts = {
  copies: ImmutableCopyEntry[];
  readCurrent: (relativePath: string) => string;
  writeSnapshot: (relativePath: string, bytes: string) => void;
  validation: ImmutableCopyValidationResult;
  revalidate: () => ImmutableCopyValidationResult;
  verdict?: string | undefined;
  noticePrefix?: string | undefined;
  emitNotice: (text: string) => void;
};

export type RecoverImmutableCopyOverreachResult = {
  recovered: boolean;
  validation: ImmutableCopyValidationResult;
};

/**
 * True when verdict text references the pinned `intent.md` path (literal or backtick-wrapped, case-sensitive).
 */
export function verdictReferencesPinnedIntentPath(verdict: string): boolean {
  return verdict.includes("intent.md") || verdict.includes("`intent.md`");
}

function formatNotice(prefix: string, revertedPaths: string[], verdict: string | undefined): string {
  const lines = [`${prefix}\n`];
  for (const path of revertedPaths) {
    lines.push(`  ${path}\n`);
  }
  if (verdict !== undefined && verdictReferencesPinnedIntentPath(verdict)) {
    lines.push("  verdict requirements for intent.md were not applied\n");
  }
  return lines.join("");
}

/**
 * Classify actuator-time immutable-copy drift via snapshot diff; on eligible failure revert snapshots,
 * re-run validation, and emit a stderr notice. Returns the post-recovery validation result.
 */
export function recoverImmutableCopyOverreach(
  opts: RecoverImmutableCopyOverreachOpts,
): RecoverImmutableCopyOverreachResult {
  if (opts.copies.length === 0 || opts.validation.valid) {
    return { recovered: false, validation: opts.validation };
  }

  const drifted: ImmutableCopyEntry[] = [];
  for (const copy of opts.copies) {
    const current = opts.readCurrent(copy.relativePath);
    if (current !== copy.snapshot) {
      drifted.push(copy);
    }
  }

  if (drifted.length === 0) {
    return { recovered: false, validation: opts.validation };
  }

  for (const copy of drifted) {
    const current = opts.readCurrent(copy.relativePath);
    if (copy.isRecoverableDrift !== undefined && !copy.isRecoverableDrift(copy.snapshot, current)) {
      return { recovered: false, validation: opts.validation };
    }
  }

  const revertedPaths: string[] = [];
  for (const copy of drifted) {
    opts.writeSnapshot(copy.relativePath, copy.snapshot);
    revertedPaths.push(copy.relativePath);
  }

  const revalidated = opts.revalidate();
  if (!revalidated.valid) {
    return { recovered: false, validation: revalidated };
  }

  const prefix = opts.noticePrefix ?? IMMUTABLE_COPY_OVERREACH_NOTICE_PREFIX;
  opts.emitNotice(formatNotice(prefix, revertedPaths, opts.verdict));
  return { recovered: true, validation: revalidated };
}

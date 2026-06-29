type ImmutableCopyEntry = {
  relativePath: string;
  snapshot: string;
  isRecoverableDrift?: ((snapshot: string, current: string) => boolean) | undefined;
};

export type RecoverImmutableCopyOverreachOpts = {
  copies: ImmutableCopyEntry[];
  validation: { valid: boolean; error: string | null };
  readCurrent?: ((relativePath: string) => string) | undefined;
  writeSnapshot?: ((relativePath: string, bytes: string) => void) | undefined;
  revalidate?: (() => { valid: boolean; error: string | null }) | undefined;
  verdict?: string | undefined;
  noticePrefix?: string | undefined;
  emitNotice?: ((text: string) => void) | undefined;
};

export function recoverImmutableCopyOverreach(opts: RecoverImmutableCopyOverreachOpts): {
  valid: boolean;
  error: string | null;
} {
  if (opts.copies.length === 0 || opts.validation.valid) {
    return opts.validation;
  }

  const readCurrent = opts.readCurrent;
  const writeSnapshot = opts.writeSnapshot;
  const revalidate = opts.revalidate;
  if (readCurrent === undefined || writeSnapshot === undefined || revalidate === undefined) {
    return opts.validation;
  }

  const drifted: ImmutableCopyEntry[] = [];
  for (const copy of opts.copies) {
    const current = readCurrent(copy.relativePath);
    if (current === copy.snapshot) {
      continue;
    }
    if (copy.isRecoverableDrift !== undefined && !copy.isRecoverableDrift(copy.snapshot, current)) {
      return opts.validation;
    }
    drifted.push(copy);
  }

  if (drifted.length === 0) {
    return opts.validation;
  }

  const revertedPaths: string[] = [];
  for (const copy of drifted) {
    writeSnapshot(copy.relativePath, copy.snapshot);
    revertedPaths.push(copy.relativePath);
  }

  const revalidated = revalidate();
  if (!revalidated.valid) {
    return revalidated;
  }

  const prefix = opts.noticePrefix ?? "review: reverted immutable-copy overreach:";
  const lines = [`${prefix}\n`];
  for (const path of revertedPaths) {
    lines.push(`  ${path}\n`);
  }
  const verdict = opts.verdict;
  if (verdict !== undefined && (verdict.includes("intent.md") || verdict.includes("`intent.md`"))) {
    lines.push("  verdict requirements for intent.md were not applied\n");
  }
  opts.emitNotice?.(lines.join(""));
  return revalidated;
}

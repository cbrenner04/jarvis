# Bare-suffix exemption in the one-artifact bullet check

A backticked, slash-free token with no real filename — a bare extension or naming-convention suffix — is never counted as an artifact path.

## Decisions

- A slash-free backticked token is a bare suffix, excluded in `referencedArtifactPaths`, when it begins with `.` and contains a second `.` (e.g. `.test-support.ts`, the un-starred form of the existing `*.test-support.ts` glob convention) — rules out treating every leading-`.` token as bare, which would also touch a single-dot root dotfile like `.gitignore` (unaffected here: it has no second dot, and stays excluded solely by the existing extension allowlist, as today).
- Lives in `referencedArtifactPaths` (section-agnostic, like the existing glob-pattern filter), not `assertSingleArtifactBullets` — `v2/src/execution/intent-split-regression.test.ts`'s direct use of `referencedArtifactPaths` on raw seed lines is unaffected and stays green.

## Acceptance criteria

- [ ] A test proves a bullet naming one artifact path plus a bare backticked suffix (`.test-support.ts`) passes; it fails against the pre-fix check.
- [ ] A test proves a single-dot root dotfile (`.gitignore`) is unaffected: still excluded via the existing extension allowlist, not reclassified by the new rule.
- [ ] `v2/src/execution/intent-split-regression.test.ts` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2`, `bun run test:integration:v2`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — one-artifact rule: a bare backticked suffix (no directory, no name before a second dot) is never a counted artifact path.

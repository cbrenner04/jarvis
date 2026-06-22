# Bounded transient retry on the sync git push / gh pr ready ops

## Problem

The actual seed-3 culprit — `gh pr ready` — does **not** route through
`runGhCommand`. It is a direct `execFileSync("gh", ["pr", "ready", branch])` that
throws on a transient TLS handshake timeout, killing a complete, reviewed run.
`git push` (`pushCurrent`, `v1/src/worktree.ts`) is the other harness-own network
op on the same `execFileSync` (sync, throws-on-failure) shape. These bypass the
gh chokepoint retry added in [00](./00-gh-chokepoint-retry.md), so they need the
same classifier + bounded retry applied to the sync execution model.

Direct `gh pr ready` sites: `v1/src/modes/patch/pr.ts` (`realGhPrReady`),
`v1/src/modes/plan/pr.ts` (`realGhPrReady`), `v1/src/modes/patch/review.ts`
(two `execFileSync("gh", ["pr","ready",...])` calls).

## Decisions

- Reuse [00](./00-gh-chokepoint-retry.md)'s classifier (`isTransientNetworkError`)
  and its retry policy (cap, backoff, harness line); no duplicated
  cap/backoff/pattern constants. Rules out a second, drifting retry
  implementation for the sync path.
- The sync path classifies on the thrown error's captured `stderr` buffer (the
  `execFileSync` failure carries `.stderr`), with the same `exitCode === 0` →
  false guard (a thrown error implies non-zero). Rules out classifying on the
  generic JS error message instead of the captured process stderr.
- Backoff between sync re-attempts uses a synchronous sleep (e.g.
  `Bun.sleepSync`) behind an injectable seam so tests do not wall-clock sleep.
  Rules out an async refactor of `pushCurrent`/`maybeMarkReady` and rules out a
  busy-spin.
- Only transient-classified throws retry. Permanent `git push` failures
  (non-fast-forward / rejected, auth) and permanent `gh pr ready` failures
  (`BLOCKED`, 404, not-authenticated) re-throw after exactly one attempt with the
  existing error text preserved. Rules out retrying a rejected push that will
  never succeed.
- The four direct `gh pr ready` shell-outs and `pushCurrent` route through one
  shared sync retry wrapper; the wrapper preserves each site's existing
  thrown-error message on permanent failure so caller try/catch behavior (e.g.
  review-final `return 1`, plan warn-and-continue) is unchanged. Rules out
  per-site bespoke retry and rules out changing the surfaced failure text.

## Task checklist

- Add a sync transient-retry wrapper (shared policy with
  [00](./00-gh-chokepoint-retry.md)) that runs an `execFileSync`-style thunk,
  classifies a thrown failure's captured stderr via `isTransientNetworkError`,
  backs off (injectable sleep), retries to the cap, then re-throws the last
  error; emits `harnessGitGhTransientRetryLine` per re-attempt.
- Apply it to `pushCurrent` (`v1/src/worktree.ts`) preserving its current
  stderr-preferring throw on permanent failure.
- Apply it to the direct `gh pr ready` shell-outs in `v1/src/modes/patch/pr.ts`,
  `v1/src/modes/plan/pr.ts`, and the two sites in `v1/src/modes/patch/review.ts`.
- Tests: a transient `git push` failure retries then succeeds; a persistent
  transient push throws after exactly 3 attempts; a permanent push rejection
  throws after exactly 1; the same three cases for `gh pr ready`; permanent
  failures preserve the existing error text so caller try/catch paths are
  unchanged.
- Docs: `v2/docs/v1-behaviors.md` (git push and direct `gh pr ready` bounded-retry
  transient failures; permanent fast-fail with preserved error text).

## Acceptance criteria

- [ ] A transient `git push` failure (e.g. connection reset / TLS handshake
  timeout) is retried on the same op and succeeds when a later attempt succeeds;
  a persistently transient push throws after exactly 3 attempts (bound, not
  external limit) (test).
- [ ] A transient `gh pr ready` failure is retried and succeeds when a later
  attempt succeeds; a persistently transient `gh pr ready` throws after exactly
  3 attempts (test).
- [ ] A permanent `git push` rejection (non-fast-forward / auth) and a permanent
  `gh pr ready` failure (`BLOCKED` / 404 / not-authenticated) each throw after
  exactly one attempt, with the existing thrown-error text preserved so caller
  try/catch behavior is unchanged (test).
- [ ] Each sync re-attempt emits `harnessGitGhTransientRetryLine` (shared with
  [00](./00-gh-chokepoint-retry.md)) (test).
- [ ] `v2/docs/v1-behaviors.md` records that `git push` and the direct
  `gh pr ready` ops bounded-retry transient failures and fast-fail permanent
  ones with preserved error text.
- [ ] `bun run typecheck` and `bun run test` pass.

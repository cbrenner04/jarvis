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

Depends on [00](./00-gh-chokepoint-retry.md): consumes its shared classifier
(`isTransientNetworkError`), cap/backoff constants, and message builder. Land 00
first.

## Decisions

- Reuse [00](./00-gh-chokepoint-retry.md)'s classifier (`isTransientNetworkError`)
  and its retry policy (cap, backoff, harness line); no duplicated
  cap/backoff/pattern constants. Rules out a second, drifting retry
  implementation for the sync path.
- The sync path classifies on the thrown error's captured `stderr` buffer (the
  `execFileSync` failure carries `.stderr`). The exitCode fed to the
  `exitCode === 0` → false guard is the error's `.status ?? -1` (`.status` is
  null on signal termination), so a thrown error never accidentally reads as
  exit 0. Rules out classifying on the generic JS error message instead of the
  captured process stderr, and rules out a null `.status` defeating the guard.
- `gh pr ready` is **not idempotent across a lost-ack retry**: the seed-3 case is
  a transient timeout *after* the server already flipped the PR to ready, so the
  ack was lost. The re-attempt then hits an already-ready PR, which `gh` exits
  non-zero on with an "already ready" / "not a draft" message that matches no
  transient pattern — so a naive retry would fast-fail on what was a success. A
  retry whose result/throw stderr matches "already ready" / "not a draft" is
  treated as **success**, not a permanent failure. This guard is
  `gh pr ready`-specific; `git push`'s analogue is benign (re-push →
  "Everything up-to-date", exit 0) and needs no guard. Rules out re-breaking
  seed 3.
- Backoff between sync re-attempts uses a synchronous sleep (e.g.
  `Bun.sleepSync`) behind an injectable seam so tests do not wall-clock sleep.
  Rules out an async refactor of `pushCurrent`/`maybeMarkReady` and rules out a
  busy-spin.
- Retry wraps the **real network op below the existing injection seam**, and the
  wrapper exposes its own exec/thunk seam that tests drive transience through.
  Each direct site today resolves `fn = opts.injected ?? realFn`; the retry must
  sit around `realFn` so production retries while injected stubs are still
  reachable, and tests exercise transience via the wrapper's exec seam rather
  than the per-site injection point. `pushCurrent` has **no seam today** — add
  one (its `execFileSync` call becomes an injectable exec thunk) so its retry is
  testable. Rules out wrapping the real op (leaves injected stubs un-retried) and
  rules out wrapping the seam call (silently changes existing test semantics).
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
  classifies a thrown failure's captured stderr (with `exitCode` = `.status ??
  -1`) via `isTransientNetworkError(exitCode, stderr)`, backs off (injectable
  sleep), retries to the cap, then re-throws the last error; emits
  `harnessGitGhTransientRetryLine(op, …)` per re-attempt. The wrapper exposes its
  own exec/thunk seam (plus the sleep seam) for tests; retry sits below each
  caller's existing injection seam.
- Add a `gh pr ready`-specific "already ready" / "not a draft" success guard so a
  lost-ack retry against an already-flipped PR returns success instead of
  fast-failing.
- Apply it to `pushCurrent` (`v1/src/worktree.ts`) — adding its injectable exec
  seam — preserving its current stderr-preferring throw on permanent failure.
- Apply it to the direct `gh pr ready` shell-outs in `v1/src/modes/patch/pr.ts`,
  `v1/src/modes/plan/pr.ts`, and the two sites in `v1/src/modes/patch/review.ts`,
  driving retry below each site's `opts.injected ?? realFn` seam.
- Tests: a transient `git push` failure retries then succeeds; a persistent
  transient push throws after exactly 3 attempts; a permanent push rejection
  throws after exactly 1; the same three cases for `gh pr ready`; an "already
  ready" stderr on a `gh pr ready` retry resolves as success; the injectable
  sleep seam fires once per re-attempt; permanent failures preserve the existing
  error text so caller try/catch paths are unchanged.
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
- [ ] A `gh pr ready` retry that hits an already-flipped PR ("already ready" /
  "not a draft" stderr) resolves as success, not a fast-fail — the lost-ack
  case that motivated this spec does not re-break (test).
- [ ] A permanent `git push` rejection (non-fast-forward / auth) and a permanent
  `gh pr ready` failure (`BLOCKED` / 404 / not-authenticated) each throw after
  exactly one attempt, with the existing thrown-error text preserved so caller
  try/catch behavior is unchanged (test).
- [ ] The injectable sleep seam is invoked once per re-attempt — N−1 times
  across N attempts — so backoff is exercised, not skipped (test).
- [ ] Each sync re-attempt emits `harnessGitGhTransientRetryLine` (shared with
  [00](./00-gh-chokepoint-retry.md)) (test).
- [ ] `v2/docs/v1-behaviors.md` records that `git push` and the direct
  `gh pr ready` ops bounded-retry transient failures and fast-fail permanent
  ones with preserved error text.
- [ ] `bun run typecheck` and `bun run test` pass.

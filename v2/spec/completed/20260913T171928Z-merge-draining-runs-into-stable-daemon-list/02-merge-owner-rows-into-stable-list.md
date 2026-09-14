# Merge owner rows into stable list

## Problem

The stable `list` handler has no way to substitute a direct predecessor's authoritative row, and must not pay predecessor-RPC or extra log-read cost when no predecessor is draining.

## Behavior

`list` runs its existing local selection (dismissal, filtering, limits, terminal retention) against local durable candidates unchanged, then — only for a candidate whose run id has a cached row in the ownership directory ([01](./01-direct-predecessor-ownership-directory.md)) — substitutes that owner's row and sets `isLive: true`. With no predecessor route configured, this substitution step is skipped entirely: no predecessor RPC, no extra per-row log read, same cost and output as today.

## Decisions

- Selection (dismissal, filters, limits, terminal retention) evaluates local durable candidate fields, never the substituted owner row's fields; substitution happens after selection, on the already-chosen candidate; rules out a routed row bypassing the filter that would have excluded its local counterpart, or matching a filter only the owner row satisfies.
- The run store is shared across daemon generations under one `JARVIS_HOME` (`v2/docs/daemon-host.md`), so every run the ownership directory reports live already has a durable local row; substitution replaces fields on that existing candidate and never appends a synthetic row. A run id present in the directory but absent from local durable candidates — reachable only via a corrupted or out-of-sync store — is dropped from the merge instead of appended.
- The direct predecessor's cached row wins duplicate run ids in the public result; rules out the successor's own reprojected fields overwriting the owner's.
- No ownership directory populated (no predecessor, or directory empty) short-circuits to the exact pre-fix local path: no predecessor RPC, no per-row log read beyond what local projection already does.
- Deferred to first consumer: control verbs (`pause`, `kill`, `resume`) routing through the owner route — pin when a caller needs it. This subspec only routes `list`.

## Tasks

- Add owner-row substitution to the stable `list` handler after existing local selection, keyed by run id against the ownership directory.
- Skip substitution entirely when the directory is empty, preserving today's cost and output.

## Acceptance criteria

- [x] `daemon-stable-run-list.test.ts` proves a direct predecessor's differing live run appears exactly once through the stable handler with the owner's fields and `isLive: true`, and that a filtered list request selects (or excludes) that run using its local durable fields even when the owner row differs on the filtered field; it fails against the pre-fix per-daemon projection, which has no substitution step.
- [x] A test proves a run id present in the ownership directory but absent from local durable candidates is dropped from the merged result rather than appended as a synthetic row.
- [x] `daemon-terminal-run-retention.test.ts` proves the no-predecessor path performs no predecessor RPC and no extra per-row log read (via injected call counters) and its existing retained-rows/order assertions stay green.
- [x] `generation-drain-and-exit.sandbox-unrunnable.test.ts` proves the real stable address returns the outgoing owner's live run exactly once with the owner's fields; it fails against the pre-fix per-daemon projection. Runs under `test:integration:v2` (`.sandbox-unrunnable.test.ts` suffix routing in `scripts/test-slice.ts`).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — merged list rules (selection on local fields, owner-row substitution, dedup-by-run-id winner) and the single-daemon fast path.
- `v2/docs/v2-architecture.md` — place direct-predecessor row substitution behind the stable `list` boundary.
- `v2/docs/v1-behaviors.md` — replace advisory live-ID-only semantics with the merged owner-row view: a draining predecessor's run shows the owner's authoritative row and `isLive: true` through the stable address, not just a liveness flag on the successor's own row.

# 02 — Test-preload real-home write guard

Tests leaked ~1.24M files into `~/.jarvis/sessions/` plus `~/.jarvis/specs/Org-*` and `specs/project/tmp-*`. The preload (`test/setup-fake-agents.ts`) sets `JARVIS_HOME` but nothing fails when a test writes the real home anyway.

## Decisions

- Guard snapshots the real home (resolved from `homedir()`, never `JARVIS_HOME`) before the run and diffs after: new entries under `sessions/` and `specs/` and size/mtime change of `telemetry.jsonl`; rules out a read-only fence, which breaks on machines where the operator daemon writes concurrently.
- Snapshot is entry-name listing of top-level `sessions/` and recursive-to-bounded-depth `specs/`, not a full recursive walk; `sessions/` already holds ~1.24M files.
- Deferred to first consumer: allowlist for concurrent operator-daemon writes to the real home — pin when a false positive is observed.
- Violation fails the suite via a nonzero exit with the offending paths listed; rules out a warning that gets ignored.
- Snapshot/diff logic is a pure exported function tested with temp-dir fixtures; the preload only wires it.

## Acceptance criteria

- [x] `test/real-home-guard.test.ts` proves the pure home-snapshot diff function reports new `sessions/`/`specs/` entries and telemetry-log changes between two snapshots, using temp-dir homes and covering both a clean and a violating run; the violating case fails against a no-op diff.
- [x] `test/setup-fake-agents.ts` takes the pre-run snapshot and fails the process with the offending paths when the post-run diff is non-empty.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes (root tooling touched).

## Documentation updates

- `v2/docs/test-writing.md` — the real-home guard, what it snapshots, and injecting `sessionsDir`/`sinkPath` instead of relying on defaults.

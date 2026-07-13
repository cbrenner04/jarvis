# The test suite writes telemetry into the operator's real `~/.jarvis`

**93% of the operator's live `~/.jarvis/telemetry.jsonl` is test-fixture data** — 891 of 955
records. Every `bun run test` and every ready gate injects fake invocations into the real
telemetry file, corrupting any cost, duration, or invocation-count analysis run against it.

## Problem

Observed 2026-07-13. Counting v2 invocations for the session's cost report gave **133 claude
invocations**. The real number was **16**. The other 117 were fixtures:

- `project: "demo"` (the test fixture project)
- `operator_session_id: "workflow"` (a literal, not a UUID)
- `worktree_path: /var/folders/.../T/jarvis-v2-<rand>/jarvis-home/worktrees/demo/...` — a
  temp fixture home that the test *did* create, but that the telemetry writer ignored.

The cause is `v2/src/execution/work-boundary-telemetry.ts:18`:

```ts
export const DEFAULT_TELEMETRY_SINK_PATH = join(homedir(), ".jarvis", "telemetry.jsonl");
```

It resolves from the real `homedir()`. The fixtures in `v2/src/testing/sandbox-git-repo.ts`
and `v2/src/testing/write-fixtures.ts` build an isolated `<tmp>/jarvis-home`, but nothing
redirects the telemetry sink to it, so any test not injecting its own sink appends to the
operator's live file.

Consequences:

- **Cost and telemetry analysis off `telemetry.jsonl` is unusable without filtering
  `project != "demo"`** — and nothing tells you that.
- It directly caused a wrong figure in this session's report (corrected).
- It grows unboundedly with every test run, on the operator's machine, forever.

Related but distinct: `tests-hermetic-machine-config` (agent-authored tests *read* the
ambient `~/.jarvis/config.json`). Same root disease — **tests are not hermetic against the
operator's jarvis home** — and both should probably be fixed by one seam.

## Decisions

- **A test must never write to the real `~/.jarvis`.** Resolve the telemetry sink from the
  same jarvis-home the fixture already constructs, not from `homedir()`. Rules out filtering
  `demo` rows at read time, which leaves the corruption in place.
- **Make the home a required, injected input rather than a default.** A default that silently
  points at the operator's real home is the defect; every consumer resolving it independently
  is how it spread. Consider one seam covering both telemetry and machine config, retiring
  `tests-hermetic-machine-config` with it.
- The existing 891 polluted rows are the operator's to purge; the fix must stop new ones.

## Prerequisites

- None.

## Out of scope

- Reconciling historical cost sheets computed off the polluted file.

## Documentation updates

- `v2/docs/test-writing.md` — tests must not touch the operator's jarvis home; how to inject
  the fixture home.
- `v1/docs/operator-runbook.md` § Cost reporting standard — until this ships, filter
  `project != "demo"` when reading `telemetry.jsonl`.

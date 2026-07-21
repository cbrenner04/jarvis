# Runtime smoke passes vacuously and never exercises component interaction

## Problem

Runtime smoke verification is one of the three mandatory completion boundaries, but it cannot
observe the class of defect that matters most: two components that each work alone and disagree
with each other.

Demonstrated on PR #1880 (2026-07-21), which passed smoke, mutation verification, the ready gate,
CI, a debate review pass, **and** auto-flipped to ready — while shipping a daemon that could never
dispatch. `EXECUTABLE_TREE_PATHSPECS` are repo-root-relative and git resolves pathspecs against the
process cwd, but the daemon called `getExecutableTreeDigest(import.meta.dir)` (`v2/src/daemon`):

```text
from repo root      : 226 entries -> 228967dea711…
from v2/src/daemon  :   0 entries -> e3b0c44298fc…   (sha256 of "")
```

The daemon's digest could never equal the CLI's, so every `start` / `resume` / `run workflow` would
mismatch, auto-bounce, mismatch again, and exit 1 — permanent refusal with a live run.

Two independent holes let it through:

1. **Discovery is a three-item allowlist.** `isRunnableEntrypoint`
   (`v2/src/execution/runtime-smoke-verifier.ts:70`) matches only `*-entrypoint.ts`,
   `v1/src/index.ts`, and `v2/src/cli.ts`. #1880's production diff was
   `shared/executable-tree.ts`, `v2/src/cli/dispatch-revision.ts`, `v2/src/daemon/daemon.ts`,
   `v2/src/daemon/daemon-lifecycle.ts`, and three more — none matched, so the verifier returned
   `not-runnable` with `"no changed runnable entrypoint found"` and the boundary **passed
   vacuously**. Note `v2/src/daemon-entrypoint.ts` exists and *is* the daemon's real entrypoint
   (`daemon-lifecycle.ts:122`); a change to `daemon/daemon.ts` is a change to what it executes, but
   discovery only looks at literal changed paths.
2. **The smoke command is `--help`.** `defaultExecuteEntrypoint` runs `bun run <entrypoint> --help`.
   Even had it selected an entrypoint, `--help` proves a process starts and prints text. It cannot
   exercise a daemon↔CLI handshake, so no `--help` invocation would have compared the two digests.

A third, compounding factor is seeded separately
(`test-doubles-that-call-production-code-encode-the-fix`): reverting the whole guard left the suite
green because the test double calls the production function.

## Decisions

- Map a changed file to the entrypoints that *load* it, rather than testing whether the changed
  path is itself an entrypoint; a change under `v2/src/daemon/**` implicates
  `v2/src/daemon-entrypoint.ts`. Rules out extending the hardcoded allowlist one path at a time.
- Smoke must exercise at least one real interaction between the components a run depends on — for
  the daemon, a start/status/stop handshake from the CLI against a freshly started daemon —
  not only `--help`. Pin the exact minimal handshake in the plan.
- The verifier must distinguish "no entrypoint implicated" from "entrypoint implicated and ran
  clean"; a vacuous pass on a production diff that touches daemon or CLI source is a failure of the
  boundary, not a pass. Consider requiring an explicit reason recorded on the run for any
  `not-runnable` result whose diff touched `v2/src/**` or `shared/**`.
- Keep the wall-clock bound; a handshake check must stay fast and must not require network.
- Rules out replacing the boundary with more unit tests — the defect class is precisely what unit
  tests with doubles miss.

## Acceptance criteria

- [ ] A production diff touching only `v2/src/daemon/**` selects `v2/src/daemon-entrypoint.ts` for
      smoke rather than reporting `not-runnable`.
- [ ] A production diff touching only `v2/src/cli/**` selects the CLI entrypoint.
- [ ] Smoke performs a real CLI↔daemon handshake (start, status, stop) and fails when the two
      disagree; a fixture reproducing the #1880 digest mismatch fails smoke.
- [ ] A `not-runnable` result on a diff touching `v2/src/**` or `shared/**` is recorded with its
      reason and is distinguishable from a genuine clean run in the run log.
- [ ] Smoke stays within its wall-clock bound and requires no network.
- [ ] Regression coverage fails against the current verifier and passes after the change.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — what smoke does and does not certify.
- `v2/docs/workflow-runner.md` — entrypoint discovery and the handshake check.

---
name: tests-never-touch-the-operator-jarvis-home
---

# Tests bind the jarvis home to their fixture, and a guard fails if one escapes

891 of the operator's 955 live `~/.jarvis/telemetry.jsonl` records are test fixtures
(`project: "demo"`, `operator_session_id: "workflow"`): the fixtures in
`v2/src/testing/sandbox-git-repo.ts` and `write-fixtures.ts` build a `<tmp>/jarvis-home`, but
nothing redirects the telemetry sink (or the machine-config read) to it, so tests that don't
hand-inject a path append to the operator's real file.

Bind the jarvis-home seam to the fixture home for the whole v2 suite, so no test needs to
remember to inject anything, and add a guard that fails the suite if a test writes into (or
ambiently reads) the real jarvis home.

Observable: run `bun run test`; the real `~/.jarvis/telemetry.jsonl` gains zero records and its
mtime is unchanged. A test deliberately writing to the real home fails the guard.

Retires the `tests-hermetic-machine-config` intent — the same seam covers the ambient
`~/.jarvis/config.json` read.

Out of scope: purging the 891 existing polluted rows (operator's, by hand).

## Prerequisites

- v2 jarvis-home paths resolve through a single injectable seam rather than `homedir()` per call site

## Documentation updates

- `v2/docs/test-writing.md` — tests must never touch the operator's jarvis home; the fixture
  binds the seam automatically; what the guard checks.
- `v1/docs/operator-runbook.md` § Cost reporting standard — telemetry rows written before this
  ships are polluted with fixture data; filter `project != "demo"` when reading historical
  `telemetry.jsonl`.

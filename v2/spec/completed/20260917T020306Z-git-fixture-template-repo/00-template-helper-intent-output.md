# 00 — Template-repo helper + intent-output

`intent-output.test.ts` `createRepo()` runs 5 git execs per test. Add a shared helper under `v2/src/testing/` that builds a template repo once per file (lazy) and returns a fresh recursive copy per test; convert `createRepo()` to it. The helper supports two modes: committed (initial files plus a commit) and uncommitted (`.git` initialized and identity configured, no commit) — [01](01-write-loop-intent-landing.md) needs the uncommitted mode to commit per-test content itself.

## Decisions

- Template is built lazily on first use and cached per module instance, not in a global preload.
- Each test gets its own filesystem copy of the cached template, so sharing the built template within a process is harmless — no test can mutate another test's state through it.
- Per-test copy is a recursive filesystem copy (including `.git`), not `git clone` — clone is itself an exec.
- Converted fixture keeps its initial commit content (`seed` file, `base` commit).

## Acceptance criteria

- [x] A shared template-repo helper exists under `v2/src/testing/` with a co-located unit test proving two committed-mode copies are independent repos sharing the template's HEAD commit and content.
- [x] The committed-mode unit test also proves a copy keeps the template's git user identity, so a commit made in the copy succeeds.
- [x] The uncommitted mode has a unit test proving a copy has an initialized `.git` with identity configured and no commits.
- [x] `v2/src/execution/intent-output.test.ts` `createRepo()` uses the helper's committed mode; no per-test `git init`/`config`/`commit` remain in it.
- [x] `v2/src/execution/intent-output.test.ts` stays green.
- [x] `v2/src/execution/intent-output.test.ts` test count is unchanged or higher versus the merge base.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` and `bun run test:integration:v2` pass.
- [x] `bun run check` passes.

## Documentation updates

- `v2/docs/test-writing.md` — new "Git fixture template repo" section: when to use the helper, its two modes, and its lazy per-file lifecycle.

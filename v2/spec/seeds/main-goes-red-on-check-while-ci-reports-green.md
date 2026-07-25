# `main` went red on `bun run check` while CI reported green

## Problem

On 2026-07-25 a clean checkout of `main` failed `bun run check` (exit 1). The offending finding was
an orphaned import in `v2/src/commands/write.test.ts`:

```text
v2/src/commands/write.test.ts:13:3 lint/correctness/noUnusedImports  FIXABLE
```

`writeMachineConfig` was still imported after PR #2162 removed its last three call sites:

```console
$ git show cd80b210 -- v2/src/commands/write.test.ts | grep -E '^[+-].*writeMachineConfig'
-    const configPath = writeMachineConfig({
-    const configPath = writeMachineConfig({
-    const configPath = writeMachineConfig({ agents: ["codex", "cursor"] });
```

**CI passed on the exact commit that contains it.** `.github/workflows/ci.yml` runs `bun run check`
unconditionally on every pull request, and the check run is recorded against the PR head:

```console
$ gh api repos/cbrenner04/jarvis/commits/dbaa72f7cca4/check-runs --jq '.check_runs[] | "\(.name) \(.conclusion) head=\(.head_sha[0:12])"'
checks success head=dbaa72f7cca4
```

So this is not the usual "CI doesn't run that step" gap, and not a stale-base merge artifact —
`write.test.ts` was untouched on `main` between the branch point and the merge. A tree that fails
`bun run check` locally passed the same command in CI. **The mechanism is unresolved.** Do not cut a
fix against a guessed cause; two prior diagnoses of adjacent failures in this repo were wrong.

Fixed on `main` in `1ccf5d07`; the red persisted from an earlier session, so every implement run in
between inherited a red ready gate and spent bounded repair iterations on code its agent never wrote.

Note `noNonNullAssertion` is `"level": "warn"` in `biome.json`, so the five assertion findings in
`workflow.test.ts` were never the failure — only the `correctness` error was.

## Decisions

- Instrument before fixing: establish why `bun run check` disagrees between CI and a local clean
  checkout on the same sha (candidates: biome version resolution under `bun install
  --frozen-lockfile`, `--changed`-style scoping, working-directory differences, cache reuse). Rules
  out changing CI config or lint levels against an unverified cause.
- A red `bun run check` on `main` must be detectable without an operator running it by hand. Whatever
  the mechanism, the push-to-`main` CI run is the backstop that should have caught it. Rules out
  relying on pre-merge PR checks alone, which validate a tree that is not what lands.
- The ready gate must not silently absorb a pre-existing red `main`: an implement run whose gate fails
  on findings outside its own diff should say so, rather than spending repair iterations on them.
  Rules out treating every red gate as the agent's fault.
- Out of scope: raising or lowering any lint rule level.

## Acceptance criteria

- [ ] The disagreement is reproduced and its cause named in the spec before any fix lands — a run on
      one sha that passes `bun run check` in CI and fails it on a clean local checkout, with the
      differing input identified.
- [ ] A commit that orphans an import on `main` is caught by CI; a regression proves the push-to-main
      path fails on a tree that fails `bun run check` locally.
- [ ] A ready-gate failure whose findings lie entirely outside the run's own diff is reported as such
      (named as pre-existing) instead of consuming the bounded repair budget; inverting the guard
      fails a test.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a red gate is not necessarily the agent's diff; how to
  check `main` before blaming a run.

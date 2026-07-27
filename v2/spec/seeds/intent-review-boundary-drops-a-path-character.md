---
name: intent-review-boundary-drops-a-path-character
---

# Intent review fails every git-enabled run: the boundary check drops one path character

## Problem

`gitStatusPaths` (`v2/src/execution/review-intent-enforcement.ts:60-73`) trims the **whole**
`git status --porcelain --untracked-files=all` output, then parses each line with `line.slice(3)`:

```ts
const status = (await runner.runAsync("git", ["status", "--porcelain", "--untracked-files=all"], cwd)).trim();
status.split("\n").forEach((line) => {
  const path = line.slice(3).trim();
```

Porcelain v1 lines are `XY<space>path`. When the first line's `X` is a space — an unstaged
modification, `<space>M path` — the output-level `.trim()` eats that leading space. `slice(3)` then starts
one character late and returns `ath` semantics: the first character of the path is lost.

The intent workflow hits this on **every** git-enabled run. The split step commits the staged
ready-intent, so the actuator's edit to it is a *tracked* `<space>M` entry, and porcelain emits tracked
changes before untracked ones — it is always line one. The mangled path no longer matches
`stagingPrefix`, so a legitimate staging-directory edit is reported as a boundary violation, the
working tree is restored, and the review step settles `invocation_failure` / `failureKind: "error"`
(`invocation_error`, `retryable: false`, `nextAction: "stop"`). No ready-intent lands.

## Evidence (2026-07-27)

Seven `jarvis run workflow intent` dispatches, seven identical failures. Critic and actuator both
recorded `exit_kind: "ok"` in telemetry (74 s / 53 s on the first), so the roles ran fine; the step
failed after them. Persisted `invocation_failure_detail`:

```json
{"failureKind":"error","bindingAttempts":[],
 "message":"critic or actuator modified files outside /Users/…/intent/absent-pipeline-config-blocks-every-impl/.jarvis-intent-stage: jarvis-intent-stage/absent-pipeline-admits-implement.md"}
```

The named file is `.jarvis-intent-stage/absent-pipeline-admits-implement.md` — inside the staging
directory. The reported path is that string minus its leading `.`, exactly one character.

Same shape on the other six branches (`gate-repair-…`, `plan-splits-…`, …); the reported path is
always the staged file with its first character removed.

Workaround in use: `--review-passes 0` (split-only). It skips the review step entirely, so the
default intent path is unusable until this ships.

## Decisions

- Parse each porcelain line from the raw line, not from a whole-output `trim()`. Rules out any fix
  that keeps trimming the aggregate and compensates downstream.
- Line splitting tolerates a trailing newline without producing an empty entry; per-line handling
  strips only the trailing newline/CR, never leading whitespace. Rules out `trimStart` per line,
  which reintroduces the same off-by-one.
- Path extraction handles the porcelain rename form `XY old -> new` by recording the destination.
  Rules out treating the whole remainder as one path for renames.
- Enforcement semantics are unchanged: staging-dir writes allowed, verdict file and its owner marker
  allowed, everything else a violation. Rules out relaxing the boundary to work around the parse bug.

## Acceptance criteria

- [ ] A test drives `gitStatusPaths` (or the enforcement entry point) against porcelain output whose
      **first** line is `<space>M <path>` (a literal leading space) and asserts the full path is returned; it fails against the
      current `.trim()`.
- [ ] A test covers a first-line untracked entry (`?? <path>`) and a staged entry (`A  <path>`) in the
      same output and asserts every path is intact.
- [ ] A test covers the rename form and asserts the destination path is recorded.
- [ ] An intent-review test where the actuator modifies a **tracked** file inside the staging
      directory completes without a boundary violation; it fails against current behavior.
- [ ] An intent-review test where a file outside the staging directory is modified still reports the
      violation with the correct, unmangled path.
- [ ] Reverting the parse fix turns the first and fourth tests RED.
- [ ] `bun run typecheck` and `bun run test:v2` are green.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove the `--review-passes 0` workaround note for intent once this
  ships; record that a boundary violation names a repo-relative path verbatim.

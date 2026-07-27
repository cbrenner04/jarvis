---
name: gate-repair-edits-unrelated-tests-to-go-green
---

# Ready-gate repair edits unrelated tests — including on workflows that write no code

## Problem

When the ready gate goes red, the repair iteration hands the whole worktree to the agent with no
scope fence. Observed twice on 2026-07-27: the repair edited test files that had nothing to do with
the run's spec, in one case weakening a v1 test to make it pass, and in one case on an **intent**
workflow — which produces only Markdown ready-intents and must never touch source at all.

A red gate on this machine is usually load flake, not the run's diff. The repair agent cannot tell
the difference, so it "fixes" whatever is red.

## Evidence

**PR #2228** (implement, husk spec). Repair attempt 1 edited `v1/test/review-feedback-command.test.ts`
— renaming `.git` before an `rmSync` that removes the whole directory anyway, a no-op edit to a file
the spec never mentions. The test passes unmodified on `main`. Reverted before merge.

**PR #2243** (intent, pipeline slice 2). The intent split produced three ready-intents; the repair
iteration then also committed:

- `v1/test/review-feedback-command.test.ts` — replaced `createGitWorktree(...)` + `rmSync(...)` with a
  bare `join(worktreeRoot, "feature-branch")`, so the test no longer creates and removes a real
  worktree. That is the second unrelated edit to the same file in one session, and it weakens what the
  test simulates.
- `scripts/test-slice.ts` + `test/test-slices.test.ts` — added three files to `LOAD_SENSITIVE_FILES`,
  a suite-wide execution-policy change.
- `.jarvis-intent-review-verdict.md` and `.jarvis-intent-review-verdict.md.owner` — harness sidecars
  that should never be published.

An intent workflow writes Markdown. Every one of those files is outside anything it can legitimately
touch.

## Decisions

- Repair iterations are scoped to the paths the run's own diff already touches, plus its spec tree.
  An edit outside that set fails the repair rather than being committed. Rules out handing the agent
  an unfenced worktree.
- A workflow whose artifact contract is Markdown-only (intent, plan) refuses any repair edit to
  source, scripts, or tests. Rules out relying on the agent's judgment about scope.
- Harness sidecars (`.jarvis-*`) are never committed by a repair iteration. Rules out treating them as
  ordinary worktree files.
- A red gate whose failures are all in files the run did not touch is reported as such — an
  out-of-scope gate failure, distinct from "this run broke something". Rules out silently retrying
  against unrelated flake.
- Load-sensitivity classification is an operator decision, not a repair-time one; a repair may not add
  entries to `LOAD_SENSITIVE_FILES`. Rules out a run relaxing the suite to pass itself.

## Acceptance criteria

- [ ] A repair iteration that edits a path outside the run's diff + spec tree fails the repair and
      names the offending path; a test drives an edit to an untouched file and fails against the
      current unfenced behavior.
- [ ] The same fence on an `intent` workflow rejects any non-Markdown edit; one test per rejected
      surface (source, script, test).
- [ ] No `.jarvis-*` sidecar appears in a repair commit; a test asserts the published tree excludes
      them and fails if the exclusion is removed.
- [ ] A gate red only in untouched files is reported as an out-of-scope gate failure, distinct from a
      run-caused failure.
- [ ] A repair that edits only in-scope files still succeeds exactly as today; existing coverage stays
      green.
- [ ] Inverting the scope check turns the first test RED.

## Documentation updates

- `v2/docs/write-behavior.md` — repair-iteration scope fence and the Markdown-only workflow rule.
- `v2/docs/operator-runbook.md` § Gate trust — a red gate in untouched files is out-of-scope; review
  every repair commit's file list before merging.

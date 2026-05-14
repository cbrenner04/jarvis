# Update PR body on every subspec commit

Wire up the body builder (subspec 01) and attribution footer (subspec
02) so that the PR description is rewritten after every successful
subspec commit, not just at draft creation. Failures warn-and-continue.

## Context

After subspec 01 and 02, all the pieces exist to assemble a fresh PR
body deterministically: a header from `index.md`, a narrative
extracted from the live PR body (or generated on first create), and a
footer from `git log` trailers. What remains is to actually call them
on every subspec commit and push the result via `gh pr edit`.

The current update path in `src/modes/patch/run.ts` (around the
`if (!state.draftPrEnsured)` block, lines ~872–889) creates the draft
exactly once and then calls `maybeMarkReady`. This subspec extends
that block: on every subspec commit, regardless of whether the draft
existed before, refresh the body.

## Decisions

- **When to update.** Only on the subspec-commit code path, after the
  push succeeds and after `ensureDraftPr` has run (the draft must
  exist before we can edit it). The existing first-iteration path
  creates the draft; this subspec adds the post-create body refresh.
  WIP commits do **not** trigger an update.
- **Update mechanism.** `gh pr edit <branch> --body-file -` with the
  new body piped on stdin. Avoid `--body <text>` to keep large bodies
  off the argv length limit. Run with `cwd: agentWorkingDir`.
- **Body assembly on update.**
  1. Fetch the current PR body via
     `gh pr view <branch> --json body -q .body`.
  2. Extract the narrative via `extractNarrative` (subspec 01). If
     missing, narrative is `null`.
  3. Build the header+narrative via `buildPrBody({ indexPath,
     narrative })`.
  4. Render the footer via `renderAttribution({ cwd, base })`.
  5. Compose: header+narrative, then (when footer non-empty)
     `\n\n---\n\n` + footer.
  6. Pipe to `gh pr edit --body-file -`.
- **Update on the same iteration that creates the draft.** When this
  is the first subspec commit (the draft was just created by
  `ensureDraftPr`), do **not** also call the update path — the
  initial-create body already has the right shape because subspec 01
  routes the create path through `buildPrBody`. Skip the update on
  the iteration where `created === true` from `ensureDraftPr`.
  Subsequent iterations always update.
- **Failure mode.** Wrap the update in `try/catch`. On error, emit a
  `harness` warning to stderr (`fanout("harness", \`failed to update
  PR body for ${activeSubspecPath}: ${message}\n\`, "stderr")`) and
  continue. Do **not** return a non-zero exit code; do **not** abort
  the iteration; do **not** persist a retry queue. The next
  successful subspec commit's update will rewrite the body from
  scratch and heal any drift, since both header and footer are
  rebuilt deterministically.
- **`maybeMarkReady` ordering.** Keep `maybeMarkReady` after the body
  update. Marking the PR ready does not change the body; the order
  is "update body, then maybe flip to ready" so a final commit's body
  refresh is in place before reviewers are notified.
- **Helper extraction.** Add `updatePrBody({ indexPath, branch, base,
  cwd })` to `src/modes/patch/pr.ts` (or a sibling module) that
  performs the fetch / extract / build / render / pipe sequence. This
  keeps `run.ts` from growing another inline blob and makes the
  update independently testable.

## Task Checklist

- [ ] Add `updatePrBody` to `src/modes/patch/pr.ts` (or a new
      module) that fetches the current body, extracts the narrative,
      assembles the new body via `buildPrBody` + `renderAttribution`,
      and pipes the result to `gh pr edit --body-file -`.
- [ ] In `src/modes/patch/run.ts`, after the existing
      `ensureDraftPr` call, when `created === false` (or for any
      subsequent subspec commit), call `updatePrBody`. Wrap in
      `try/catch`; on error fan out a warning and continue.
- [ ] Confirm `state.draftPrEnsured` (or an equivalent flag) lets the
      code distinguish "we just created the draft this iteration"
      from "draft already existed at the start of this iteration".
- [ ] Add unit tests for `updatePrBody`: composes correct body when
      narrative markers exist; omits narrative section when markers
      missing; omits footer when `renderAttribution` returns empty;
      surfaces `gh` failures as thrown errors (the warn-and-continue
      happens in `run.ts`, not in the helper).
- [ ] Add an integration-style test (or extend an existing patch-mode
      test) verifying that after two subspec commits, the PR body
      reflects the updated checklist state and the per-commit list
      contains both commits.

## Acceptance criteria

- [ ] After the first subspec commit, the PR body matches the output
      of `buildPrBody` + `renderAttribution` (no double-update).
- [ ] After every subsequent subspec commit, the PR body is rewritten
      via `gh pr edit --body-file -` with a freshly assembled body.
- [ ] WIP commits do not trigger a body update.
- [ ] When `gh pr edit` fails, jarvis emits a `harness` stderr warning
      naming the active subspec and continues the iteration with a
      zero exit contribution. The next successful subspec update
      heals the body.
- [ ] `maybeMarkReady` continues to run after the body update, with
      no change to its existing behavior.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- [ ] In `README.md`, update the "Commit shape" or PR-body section to
      document that the body is rewritten on every subspec commit and
      that failures warn-and-continue (heal on next subspec commit).
- [ ] In `docs/worktrees-and-commits.md`, add an "Update cadence"
      paragraph to the PR body section describing when updates fire,
      what survives reviewer edits (narrative markers), and the
      warn-and-continue failure mode.

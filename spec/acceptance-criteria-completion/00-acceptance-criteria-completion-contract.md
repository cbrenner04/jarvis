# 00 - Acceptance-criteria completion contract

## Problem

Today, `jarvis run` decides a subspec is complete only when the agent flips
the matching `- [ ]` link in the parent `index.md`. The agent must remember
to touch a file in a *different* directory from the one it has been editing.
In practice, agents reliably do the work but forget the index flip, leaving a
dirty worktree and triggering the exit-6 "edits but no transition" halt
(`src/commands/run.ts:444-453`). Every recovery requires a human.

The signal we actually want is already in each subspec: the
`## Acceptance criteria` checklist. Agents naturally tick those boxes as
they complete work in the file they are already editing. Using that as the
completion contract removes the cross-file memory requirement.

## Behavior

The new contract for an `index.md` run iteration:

1. The agent works on the active subspec (the first unchecked link in the
   index, same as today).
2. After the agent run, the harness reads the subspec's
   `## Acceptance criteria` section and counts checked vs. unchecked items.
3. Decide outcome:
   - **All criteria checked** (and at least one was unchecked before this
     iteration, or all were already checked but the index box was not yet
     flipped): the subspec is complete. The harness flips the index box,
     runs the existing `commitSubspec` flow (commit + push + draft PR),
     and continues to the next subspec.
   - **Some new criteria checked, some still unchecked**: progress.
     The harness creates a WIP commit
     (`WIP: <subspec H1> (M/N criteria)` with body `Spec: <relpath>` and
     the list of criteria newly checked this iteration) and re-iterates on
     the same subspec.
   - **No new criteria checked and worktree dirty**: no progress.
     Halt with exit 6 and a message that names the subspec and the unchecked
     acceptance criteria, instructing the operator to inspect the worktree.
   - **No new criteria checked and worktree clean**: same "no progress"
     halt the loop already produces (exit 4 today). Keep that behavior.
4. The agent prompt no longer mentions flipping the index box. It tells the
   agent to tick acceptance-criteria checkboxes when (and only when) the
   criterion is actually met, and to stop when meaningful progress has been
   made or the work is blocked.

The `## Task Checklist` (or `## Tasks`) section is informational only. It is
not part of the completion signal.

A subspec missing a `## Acceptance criteria` section (or with zero
checkboxes in that section) is malformed. The harness halts with a clear
error before running the agent. `commitSubspec` already requires this
section to exist; this just moves the check earlier.

## Files To Modify

- `src/subspec.ts` — add parsing/snapshot helpers for acceptance-criteria
  state. Reuse `extractAcceptanceCriteria` rather than duplicating regex.
- `src/commands/run.ts` — replace the `newlyCheckedSubspecs` block
  (roughly lines 326–453) with the acceptance-criteria-driven decision tree
  described above. The harness, not the agent, flips the index box; this is
  done by writing `index.md` before calling `commitSubspec` (or by extending
  `commitSubspec` to accept a "flip the index box now" mode — pick whichever
  keeps `commitSubspec` small).
- `rules/patch-mode.md` — replace the "Flip exactly one box to `[x]`, then
  stop" guidance with acceptance-criteria-tick guidance.
- `docs/run-loop.md` — update the exit-6 description to cover
  "edits but no acceptance-criteria progress" instead of "no index
  transition".
- `AGENTS.md` — the bullet under "Working rules" that currently says
  "Jarvis will flip the index checkbox and create the commit. Do not check
  it yourself" should be updated to describe the acceptance-criteria signal
  and the WIP-commit-per-iteration behavior.

## Files To Create

- None.

## Decisions

- Acceptance-criteria-only as the completion signal. The Task Checklist is
  not consulted.
- The harness flips the index checkbox; the agent never does.
- Partial-progress iterations create real WIP commits (not staged-but-not-
  committed work). This preserves the existing invariant that no iteration
  ends with a dirty worktree past the harness boundary.
- WIP commit message: `WIP: <subspec H1> (M/N criteria)` summary line, body
  starts with `Spec: <relative path>` and lists the criteria newly checked
  in this iteration (verbatim text after the `- [x]`).
- The final completion commit keeps today's `commitSubspec` format
  (H1 summary, body = `Spec: <relpath>` + full acceptance-criteria block).
- "Newly checked" means "was `[ ]` in the previous snapshot and is `[x]`
  now". If the agent unchecks a previously-checked criterion, that is
  treated as a no-op for progress purposes (no warning, no rollback);
  this matches today's leniency around partial state.
- Section header match: `## Acceptance criteria` is case-insensitive on the
  word "criteria" only to the extent the existing regex already allows.
  Don't broaden the match.
- Malformed-subspec (missing section or zero checkboxes) halts with a new
  exit code? No — reuse exit 1 (harness error). Add the failure message
  to the test, but don't introduce a new code.

## Task Checklist

- [ ] Add `snapshotAcceptanceCriteria(subspecPath)` and a diff helper to
      `src/subspec.ts`. Each entry is `{ text, checked }`.
- [ ] Add a helper that flips the index checkbox for a given subspec path
      without making the commit (extract from `commitSubspec` or expose a
      small new function). `commitSubspec` continues to work as today for
      the final commit.
- [ ] Add a `commitWipProgress` helper that commits the current worktree
      with the WIP message format.
- [ ] In `src/commands/run.ts`, replace the post-iteration block to use the
      new contract: snapshot before, snapshot after, decide
      complete/partial/no-progress, act accordingly. Remove the
      `newlyCheckedSubspecs` / `snapshotLinkedSubspecs` / index-checkbox
      detection plumbing if nothing else uses it.
- [ ] Halt early with a clear message if the active subspec is missing
      `## Acceptance criteria` or has zero checkboxes in it.
- [ ] Update the `worktreeCompletionBlocker` no-transition message to
      reference acceptance-criteria progress instead of "the active index
      item". The exit code stays 6.
- [ ] Update `rules/patch-mode.md` to remove "Flip exactly one box" and
      add acceptance-criteria-tick guidance. Keep the rule file terse.
- [ ] Update `AGENTS.md` "Working rules for agents in this repo" bullets
      that mention the index-checkbox flip.
- [ ] Update `docs/run-loop.md` exit-6 description.
- [ ] Add tests covering: full completion (criteria all flipped → index
      flipped + commit), partial progress (WIP commit + re-iterate), zero
      progress dirty (exit 6), zero progress clean (exit 4), malformed
      subspec (exit 1 with clear message), agent unchecks a criterion
      (no-op).
- [ ] Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [ ] An iteration that leaves all acceptance-criteria boxes `[x]` causes
      the harness to flip the index checkbox, create the final commit via
      `commitSubspec`, push, and proceed to the next subspec — with no
      agent intervention on the index file.
- [ ] An iteration that flips some but not all acceptance-criteria boxes
      produces a WIP commit whose summary matches
      `WIP: <subspec H1> (M/N criteria)` and whose body lists the newly
      checked criteria; the loop continues on the same subspec.
- [ ] An iteration that edits files but flips zero acceptance-criteria
      boxes exits 6 with a message naming the subspec and listing the
      still-unchecked acceptance criteria.
- [ ] An iteration that produces no edits and no flipped boxes exits 4
      with the existing "no progress" message.
- [ ] Running against a subspec with no `## Acceptance criteria` section,
      or zero checkboxes inside it, halts before invoking the agent with a
      message identifying the subspec and the missing section.
- [ ] The agent prompt (`rules/patch-mode.md` + `src/prompt.ts`) no longer
      instructs the agent to flip the index checkbox.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- [ ] `docs/run-loop.md` — exit-6 description reflects the new contract.
- [ ] `AGENTS.md` — "Working rules for agents in this repo" reflects the
      new contract (no manual index flip; tick acceptance criteria as you
      satisfy them; expect WIP commits between iterations).

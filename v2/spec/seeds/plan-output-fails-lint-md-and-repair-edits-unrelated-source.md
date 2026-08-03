---
name: plan-output-fails-lint-md-and-repair-edits-unrelated-source
---

# Plan drafts fail `lint:md` on their own output, and gate repair answers by editing unrelated production source

## Problem

The plan write step drafts Markdown and finalizes without ever linting it. `lint:md` then runs in the
ready gate, goes red on the spec the run just wrote, and the run enters bounded gate repair. The
repair agent applies a partial Markdown fix **and** edits unrelated production source, then the
finalization boundary commits nothing and the run settles `completion_commit_failed`. The PR exists
but is red, and the plan does not land without a hand fix.

Both failures cost a hand-finish: discard the production edits, keep the Markdown fix, commit, push,
merge.

## Evidence

Two plan runs on 2026-08-03, same session, same shape:

| Run | Spec | Gate failure | Repair also touched |
| --- | --- | --- | --- |
| `f225849b` → `5fd45995` | `tui-command-editor` subspec 00 | `MD012` × 1 | `v2/src/tui/tui-entry.tsx`, `v2/src/tui/tui-monitor-lines.ts` |
| `77b741af` → `080e3d64` | `tui-command-dispatch` subspec 02 | `MD038` × 4 | `v2/src/tui/tui-entry.tsx`, `v2/src/tui/tui-monitor-lines.ts` |

Both gate runs were red on `lint:md` **only**, and named the offending spec file and rule. Both
repair attempts nevertheless rewrote the same two production files — replacing non-null assertions
with `undefined` checks in `keyedSocketDigest` and `dockInputWindow`. Those two files carry the
repo's three standing `noNonNullAssertion` **warnings**; `bun run fix` on `main` applies no such
change ("Checked 568 files… No fixes applied"), so this is the repair agent acting on warning noise
in the gate output, not autofix.

Both runs then settled `completion_commit_failed` with all three files uncommitted.

## Decisions

- The plan write step lints its own staged Markdown before finalization and reprompts on failure —
  rules out the ready gate being the first thing that reads the plan's Markdown. The same applies to
  the intent write step, which drafts Markdown on the identical seam.
- Lint failures in the run's own authored Markdown are repaired by the authoring step, not by the
  gate-repair agent — rules out spending repair iterations on a defect the writer could have caught.
- A gate-repair attempt writes only to paths attributable to the failing gate steps; edits outside
  that set are refused and reported — rules out a Markdown failure producing production source
  edits.
- Out of scope: the `noNonNullAssertion` warnings themselves (pre-existing and green), autofix
  behavior (`seeds/gate-autofix-can-turn-a-green-tree-red`), and the opaque
  `completion_commit_failed` diagnostic (shipped in #2549 / remaining branches of
  `surface-the-completion-commit-error-instead-of-swallowing-it`).

## Acceptance criteria

- [ ] A plan write step whose staged Markdown violates a configured `lint:md` rule reprompts with
      the rule and location instead of finalizing; a regression fails against the baseline, which
      finalizes unconditionally.
- [ ] A plan write step whose staged Markdown is clean finalizes with no extra invocation — the
      check adds no cost to the passing path.
- [ ] The intent write step enforces the same contract on its staged Markdown.
- [ ] A gate-repair attempt that writes a path outside the failing gate steps' attributable set is
      refused, and the refusal names the out-of-scope paths; a regression covers a `lint:md`-only
      failure answered with a `.ts` edit.
- [ ] Replaying the two recorded failures (a spec with `MD012` multiple-blanks, and one with
      `MD038` spaces-in-code-span) reaches a green gate without a repair iteration.
- [ ] Mutation checkpoint: a `// @mutate` directive removing the staged-Markdown lint gate turns the
      reprompt regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan and intent write steps lint their staged Markdown before
  finalization.
- `v2/docs/operator-runbook.md` § Gate trust — gate repair is scoped to the failing steps'
  attributable paths.

## Prerequisites

- Plan and intent write steps stage Markdown before a finalization/landing boundary
  (`v2/src/execution/plan-workflow-steps.ts`, `intent-workflow-steps.ts`).
- Bounded gate repair already classifies attributable vs out-of-scope failing paths
  (`ready_gate_out_of_scope`).

---
name: gate-repair-fence
---

# Gate repair: scope by base-ref reproduction, fence writes to attributable paths, verify autofix

One bundle: all three defects live in the same repair-entry pipeline (autofix → classify → repair),
and the first two are halves of one fence — what the repair allowset *contains* and what the repair
agent may *write*. Designed separately they yield two divergent notions of "attributable paths".
Absorbs `out-of-scope-gate-classification-strands-caused-failures`,
`gate-autofix-can-turn-a-green-tree-red`, and the repair-scope half of
`plan-output-fails-lint-md-and-repair-edits-unrelated-source` (2026-08-04); that seed's write-step
half is split out to `plan-intent-write-steps-lint-own-markdown`.

## Problem A — out-of-scope classification strands failures the run caused

`ready_gate_out_of_scope` (#2313) classifies a red gate as out of scope when the failing paths are
not in the run's diff. But a run routinely breaks a test in a file it never edited — that is what
changing a public shape does — and the classifier calls those failures out of scope, refuses
repair, and settles `resumable: true` over a condition no resume can change. Observed 2026-07-30 on
`20260730T084815Z-list-row-step-honesty` (PR #2334): three resumes, all identical —
`ready_gate_out_of_scope`, `readyGateOutsidePaths: ["v2/src/daemon/daemon.sandbox-unrunnable.test.ts"]`,
`iterationsConsumed: 0`. That file passes on `main` and fails in the worktree because the run's
added list-row fields changed the snapshotted frame; the fix is a one-line test update the fence
forbids.

## Problem B — repair answers a Markdown failure by editing unrelated production source

Two plan runs on 2026-08-03, same shape: gate red on `lint:md` **only**, naming the spec file and
rule (`f225849b` → `5fd45995`, `MD012` × 1; `77b741af` → `080e3d64`, `MD038` × 4). Both repair
attempts applied a partial Markdown fix **and** rewrote `v2/src/tui/tui-entry.tsx` and
`v2/src/tui/tui-monitor-lines.ts` — replacing non-null assertions flagged only as standing
**warnings** in the gate output (`bun run fix` on `main` applies no such change). Both runs then
settled `completion_commit_failed` with all three files uncommitted; both cost a hand-finish.

## Problem C — autofix can turn a green tree red, and the gate cannot self-repair it

The ready gate runs project autofix once per repair entry before any repair agent. On current
`main`, `bun run fix` rewrites `fullTreeRows.findIndex((entry) => entry === treeRow)` to
`fullTreeRows.indexOf(treeRow)` in `v2/src/tui/tui-monitor-lines.ts`; `treeRow` is
`T | undefined`, the callback form accepted that, `indexOf` does not — `bun run typecheck` goes
red. Observed 2026-08-02 on `20260802T042601Z-tui-selection-detail-pane`, run `bc349efa`: autofix
rewrote the line, the run settled `completion_commit_failed` with the edits uncommitted, resume
settled `ready_gate_failed` on the red typecheck, and it landed only after a hand-edit. The gate
cannot repair this class: every repair entry re-runs autofix, which re-applies the same break.
Autofix output is committed (or left on disk) without being re-verified.

## Decisions

- Scope is decided by whether the failure reproduces on the run's base ref, not by diff membership:
  run the failing scope at `--base`, and classify out of scope only when it fails there too — rules
  out path membership as the sole signal, which is what strands caused failures.
- A failure that passes on base and fails in the worktree is **in scope**: repair proceeds and the
  failing file joins the repair allowset for that gate only — rules out both refusing repair and
  widening the fence generally.
- The base-ref probe is scoped to the failing files the gate already reports — rules out doubling
  gate wall time. A probe that cannot run classifies **in scope** so repair is attempted — rules
  out fail-closed behavior whose only outcome is an unrecoverable row.
- An out-of-scope settlement stays `failed` and stops advertising `resumable: true` unless a resume
  could plausibly change the outcome — rules out the row that invites an infinite resume loop.
- A gate-repair attempt writes only to the attributable allowset — the same set the classification
  above computes; edits outside it are refused and the refusal names the out-of-scope paths — rules
  out a Markdown failure producing production edits, and rules out two path-set notions.
- Autofix runs `typecheck` on its own output before the fence commit; when it fails, the autofix
  edits are reverted, the discard is logged with the failing output, and the gate proceeds to
  repair on the pre-autofix tree — rules out a repair step that can only make things worse.
- Disable or scope the offending lint rule so `bun run fix` does not produce the unsafe
  `findIndex` → `indexOf` rewrite on a possibly-`undefined` needle; keep type-safe call sites as
  they are — rules out leaving a known-red autofix armed.
- Out of scope: plan/intent staged-Markdown self-lint (`plan-intent-write-steps-lint-own-markdown`),
  the repair-iteration budget, and the uncommitted-autofix-edits path into
  `completion_commit_failed` (evidence, not fixed here).

## Acceptance criteria

- [ ] A pre-fix-failing regression drives a red gate whose failing file is outside the run diff but
      passes on the base ref: the run classifies it in scope, admits repair, and adds only that file
      to the repair allowset for that gate.
- [ ] A red gate whose failing file fails on the base ref too still settles
      `ready_gate_out_of_scope` with that path named, and existing #2313 regressions stay green.
- [ ] A base-ref probe failure classifies in scope; a regression asserts repair is attempted and the
      probe error is reported.
- [ ] An out-of-scope settlement reports `resumable` consistently with what a resume can change; a
      regression asserts a resume over an unchanged out-of-scope condition is refused by name rather
      than re-settling identically.
- [ ] A gate-repair attempt that writes a path outside the failing gate steps' attributable set is
      refused, and the refusal names the out-of-scope paths; a regression covers a `lint:md`-only
      failure answered with a `.ts` edit.
- [ ] `bun run fix` on a clean checkout leaves `bun run typecheck` green; a test pins the specific
      unsafe rewrite (possibly-`undefined` needle) as not applied.
- [ ] When autofix produces a tree that fails `typecheck`, the gate reverts the autofix edits,
      records the discard with the failing output, and enters repair against the pre-autofix tree
      instead of committing the broken edits.
- [ ] A run whose autofix output typechecks is unaffected: the fence commit, republish, and re-gate
      path is unchanged; a regression covers it.
- [ ] Mutation checkpoints: `// @mutate` directives inverting the base-ref comparison, removing the
      write-fence refusal, and removing the post-autofix typecheck verification each turn their
      pinning test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — out of scope means "fails on base too" and is not
  fixed by resume; repair is fenced to the failing steps' attributable paths; autofix is verified
  before it is committed, and what the discard log looks like.
- `v2/docs/write-behavior.md` — base-ref reproduction probe and the per-gate allowset addition.

## Prerequisites

- `ready_gate_out_of_scope` classification (#2313) and the bounded gate-repair loop
- The ready-gate autofix entry (`fixCommand` / built-in `bun run fix`, fence-validated commit,
  republish, re-gate)
- `biome.json` (or equivalent) rule configuration behind `bun run fix`

---
name: gate-repair-fence
---

# Gate repair: base-ref scope, attributable write fence, verified autofix

Single execution-loop surface (`publishWithReadyRepair`, `classifyReadyGateFailure`, ready-gate repair fence); `biome.json` pins a known-red autofix only — splitting by module boundary does not apply.

## Problem

Three defects share the ready-gate repair entry pipeline (autofix → classify → repair). Classification and the write fence are halves of one allowset: diff membership today strands caused failures as `ready_gate_out_of_scope` with `resumable: true` over a condition no resume can change; repair agents answer Markdown-only `lint:md` reds by editing unrelated production source; autofix can turn a green tree red and every repair entry re-applies the same break because autofix output is not typecheck-verified before commit.

## Decisions

- Scope is decided by whether the failure reproduces on the run's base ref, not diff membership — rules out path membership as the sole out-of-scope signal.
- A failure that passes on base and fails in the worktree is in scope; repair proceeds and the failing file joins the repair allowset for that gate only — rules out refusing repair and widening the fence generally.
- The base-ref probe is scoped to failing files the gate already reports — rules out doubling gate wall time.
- A probe that cannot run classifies in scope so repair is attempted — rules out fail-closed behavior whose only outcome is an unrecoverable row.
- An out-of-scope settlement stays `failed` and stops advertising `resumable: true` unless a resume could plausibly change the outcome — rules out infinite identical resume loops.
- Gate-repair writes only to the attributable allowset the classification computes; edits outside it are refused naming the out-of-scope paths — rules out Markdown failures producing production edits and two divergent path-set notions.
- Autofix runs `typecheck` on its own output before the fence commit; when it fails, autofix edits are reverted, the discard is logged with the failing output, and the gate proceeds to repair on the pre-autofix tree — rules out a repair step that can only make things worse.
- Disable or scope the offending lint rule so `bun run fix` does not produce the unsafe `findIndex` → `indexOf` rewrite on a possibly-`undefined` needle — rules out leaving a known-red autofix armed.
- Out of scope: plan/intent staged-Markdown self-lint (`plan-intent-write-steps-lint-own-markdown`), the repair-iteration budget, and the uncommitted-autofix-edits path into `completion_commit_failed` (evidence, not fixed here).

## Acceptance criteria

- [ ] A pre-fix-failing regression drives a red gate whose failing file is outside the run diff but passes on the base ref: the run classifies it in scope, admits repair, and adds only that file to the repair allowset for that gate.
- [ ] A red gate whose failing file fails on the base ref too still settles `ready_gate_out_of_scope` with that path named, and existing #2313 regressions stay green.
- [ ] A base-ref probe failure classifies in scope; a regression asserts repair is attempted and the probe error is reported.
- [ ] An out-of-scope settlement reports `resumable` consistently with what a resume can change; a regression asserts a resume over an unchanged out-of-scope condition is refused by name rather than re-settling identically.
- [ ] A gate-repair attempt that writes a path outside the failing gate steps' attributable set is refused, and the refusal names the out-of-scope paths; a regression covers a `lint:md`-only failure answered with a `.ts` edit.
- [ ] `bun run fix` on a clean checkout leaves `bun run typecheck` green; a test pins the specific unsafe rewrite (possibly-`undefined` needle) as not applied.
- [ ] When autofix produces a tree that fails `typecheck`, the gate reverts the autofix edits, records the discard with the failing output, and enters repair against the pre-autofix tree instead of committing the broken edits.
- [ ] A run whose autofix output typechecks is unaffected: the fence commit, republish, and re-gate path is unchanged; a regression covers it.
- [ ] Mutation checkpoints: `// @mutate` directives inverting the base-ref comparison, removing the write-fence refusal, and removing the post-autofix typecheck verification each turn their pinning test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — out of scope means "fails on base too" and is not fixed by resume; repair is fenced to the failing steps' attributable paths; autofix is verified before it is committed, and what the discard log looks like.
- `v2/docs/write-behavior.md` — base-ref reproduction probe and the per-gate allowset addition.
- `v2/docs/v1-behaviors.md` — record the base-ref scope and attributable write-fence contract for v2 ready-gate repair.

## Prerequisites

- Ready gate failures whose every attributable failing path lies outside the run diff plus spec tree settle as `ready_gate_out_of_scope` with named outside paths; in-scope failures enter bounded repair.
- Bounded ready-gate repair invokes the agent on red gates, commits, and republishes for up to three attempts; each attempt consumes one write iteration.
- Ready-gate repair derives and freezes an allowset from the committed run diff and spec tree before autofix or the first repair agent runs.
- Ready-gate repair runs project autofix once per repair entry before the repair agent (`fixCommand` or built-in `bun run fix`), fence-validates staged candidates, commits in-scope changes, and republishes before agent repair when the gate stays red.
- `biome.json` (or equivalent) rule configuration behind `bun run fix` is present and exercised by the jarvis repo's fix entrypoint.

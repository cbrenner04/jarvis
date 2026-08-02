# v2 implement queue

Authority: operator priorities. Updated 2026-08-02.

## Goal

TUI slices 1-4 are shipped. Slice 5 (command dock) is **half shipped**: the parser, the pure dock
projection, and the reusable start-admission API landed; wiring the dock into the shell is stuck at
the mutation gate. Then slice 6 (steering + log) from
[tui-overhaul-brief.md](tui-overhaul-brief.md).

## Start here next

**Unblock [PR #2533](https://github.com/cbrenner04/jarvis/pull/2533)** (`20260802T075146Z-tui-dock-projection`,
subspecs 01-03: dock identity, dock state/RPC feedback, painting). Criteria are ticked and
`typecheck` / `check` / `test:v2` are green; the harness refuses completion on a surviving
`operator-flip` in `v2/src/tui/tui-entry.tsx`.

Both flagged sites are **unobservable defensive code**, verified by hand:

- the run-owner eviction filter is superseded a few statements later by `runOwners = owners`,
  rebuilt from the refresh's successful lists with no yield between them (already removed);
- flipping the `clearSelection` guard leaves the whole suite green, because selection clearing is
  already handled on refresh.

So this needs a **decision**, not more coverage: delete the dead `clearSelection` block (a refactor
beyond this spec's scope) or exempt these sites. Then
`jarvis run resume e734022c-d610-459c-ab21-7f7268f8f083`.

After that: slice 5's last leaves (`ready-intents/tui-command-editor`,
`ready-intents/tui-command-dispatch`), then seed slice 6.

| Slice | Shipped |
| --- | --- |
| 1 — shell layout | #2453, #2456 |
| 2 — pipeline tree | #2462, #2463, #2466, #2471, #2473, #2479, #2481, #2485 |
| 3 — elapsed columns | #2490, #2492 |
| 4 — detail pane | #2511 (wire), #2519 (pipeline + stage), #2521 (selected run + wrapping) |
| 5 — command dock | #2529 (parser), #2530 (start admission), #2531 (dock rows); **#2533 open** |
| 6 — steering + log | not seeded |

## Open seeds, newest first

| Seed | Why |
| --- | --- |
| `seeds/mutation-verification-outlives-its-run` | An `iteration_timeout` stranded **three** applied `@mutate` directives in production source, and the verifier kept mutating that worktree after the run row was terminal. Salvage required reversing every directive mechanically. |
| `seeds/gate-autofix-can-turn-a-green-tree-red` | `bun run fix` rewrites `findIndex` → `indexOf` on a possibly-`undefined` needle; the result fails `typecheck` on `main`. Red-gated a run twice and cannot self-repair, since every repair entry re-runs autofix. |
| `seeds/mutation-selector-fires-on-prose-mentions-of-the-marker` | #2518 selects on a bare `@mutate` substring, so a spec that discusses the marker in prose fails its own gate. |
| `seeds/tui-waitstate-is-polled-but-no-longer-rendered` | Slice 4 left `waitState` with no reader while the `wait` RPC still fires per selection change; also names the right-pane/left-pane retention disagreement. |
| `seeds/intent-landing-contract-rejects-wrapped-bullets` | Still open. Blocked two intent runs on 2026-08-01. |

## Harness fixes landed this session

- **#2518** — `spec.criteria-ticked` now selects mutation-checkpoint criteria by the phrase **or** a
  quoted `@mutate` directive. Before it, a criterion naming the directive directly was silently
  never verified — which is exactly how #2511's two checkpoints reached `main` unproven.
- **#2517** — the human-only marker contract is stated in `DEFAULT_WRITE_STEP_RULES` and
  `spec-guidance.md`, with isolated per-injection regressions across v1 patch and v2
  intent/plan/write/implement.

## Defer unless you hit them in session

| Seed / intent | Status | Notes |
| --- | --- | --- |
| `seeds/iteration-timeout-discards-completed-subspecs` | Open, and it bit again this session | Cost a full salvage of dock-projection subspec 00. Workaround: split large subspecs at plan time. |
| `seeds/out-of-scope-gate-classification-strands-caused-failures` | Open | Run-caused test failures classified out of scope (#2313). |
| `seeds/mutation-verification-artifact-reached-the-completion-commit` | Open | Superseded in part by `mutation-verification-outlives-its-run`. |
| `ready-intents/guard-bare-settimeout-in-deterministic-tests.md` | Ready | Hygiene. |
| `ready-intents/aggregate-timeout-reaps-the-test-process-group.md` | Ready | Only if a hung test descendant is observed. |
| `ready-intents/split-v2-review-prompt-ids-from-v1.md` | Ready | Prereq to later review work only. |
| `ready-intents/execution-loop-human-only-contracts.md` | Planned, **not implemented** | Spec `20260802T035103Z-execution-loop-human-only-contracts` is on `main` awaiting an implement run. |

## Rule

No reliability phase is open beyond the tables above. Pipelines are done; the TUI brief is the
active phase.

## Configured pipeline

`jarvis pipeline start jarvis --seed <path>` was dogfooded 2026-08-01; approval scoping (#2447)
holds. Until `seeds/pipeline-fanout-stage-dispatch-contends-on-the-prior-worktree` ships, fan-out
pipelines need branch gates approved **one at a time**, and a terminal `failed` must be confirmed
against `jarvis run list` before you believe it.

## Carried operator notes

- **Review every implement diff with a subagent before merging.** Seven implement PRs reviewed this
  session; five carried a real finding the green gate did not — including two in the operator's own
  hand-edits. The rate has not dropped across three sessions.
- **A mutation checkpoint is only worth what an applied mutation proves.** Reviewers applied every
  directive by hand this session and found: a directive quoting text the formatter had wrapped
  (unresolvable, never ran), a directive whose mutation was a no-op against redundant disjuncts, a
  directive pointing at a guard a refactor had deleted, and a duplicated guard that made its
  checkpoint survive. All four were in code that passed CI.
- **`iteration_timeout` and gate autofix are the two run-killers.** Neither self-heals: autofix that
  breaks `typecheck` re-breaks it on every repair entry, and an iteration timeout is
  `resumable: false`. Both cost a hand salvage this session.
- **An entry run ID reporting `completed` does not mean the workflow finished** — the write row is
  often still live. Wait on the row from `jarvis run list`, not the ID `--detach` printed.
- **Do not pass `--reset-despite-dirty` on an incomplete spec you care about** — unless the work is
  already on `main`, which is the one case where it is the right call.
- **Do not admin-merge over a red check.** It reddened `main` once (#2417).
- `bun test` **does not typecheck.** Hand-finishing: `bun run check` and `bun run typecheck`.
- **CI does not run `lint:md`.** Run it locally before merging any markdown-touching PR.

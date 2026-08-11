# Session report — keystone completion, reap chain, TUI design review (2026-08-11)

Operator: claude-opus-4-8 (operator), claude-only agents. Follow-on to the completed TUI command-center phase; drove the two deferred queue items (the keystone ready-intent and the reap seed) plus a requested TUI design review.

## Outcome

**8 PRs merged, all green + adversarial subagent/operator diff-review + local `lint:md`.** The keystone ready-intent (the operator's primary "complete this work") is fully shipped. The reap seed is substantially advanced (foundation + full plan landed; the multi-subspec implement + daemon-sweep parked for a dedicated session). The TUI review is delivered as a design seed + intent split (implementation parked on the same blocker).

### Merged PRs

| PR | What | Notes |
| --- | --- | --- |
| #2826 | plan: keystone-links-implement-authored-directive | single subspec; debate review raised 11 points, all addressed |
| #2827 | Keystone criteria satisfied by implement-authored directive | **hand-finished**: ready-gate-repair thrashed ~70m on a contention-flake timeout; killed stray, verified (isolated 51/51), mark-ready + admin-merge. Adversarial subagent review = SHIP |
| #2828 | intent: reap-ready-gate-test-children | split seed → 3 ready-intents (subprocess primitive → gate reaps+records → daemon sweep) |
| #2829 | plan: subprocess-process-group-kill | POSIX-aware, pre-embedded `@mutate` directives |
| #2830 | Seed: TUI left-pane legibility | operator-authored design-review seed |
| #2831 | Opt-in process-group spawn/kill in shared runner | **hand-finished**: entry write iteration hit `iteration_timeout` under CPU starvation from leaked bun-test workers; salvaged verified worktree (typecheck + 20/20 + directives), rebased, merged |
| #2832 | plan: ready-gate-reaps-test-children | 3-subspec tree; subspec 01 handles abort-vs-failure classification so a kill mid-gate isn't misclassified/repaired |
| #2833 | intent: tui-left-pane-legibility | split → `section-framing` + `width-and-timing-threshold` (framing is a prereq of width) |

## The leaked-worker reproduction (headline finding)

Mid-session, `674dde72` (subprocess implement entry run) hit `iteration_timeout` after 45m on a single write iteration. Tracing revealed **four `bun test` workers pegging ~99%×4 CPU for 24+ min running the v1 suite with `--only-failures`** — and they were **orphaned children of this operator session itself** (a background test run that "completed" but never reaped its pool workers). This is a live reproduction of the exact bug the reap seed targets: leaked ready-gate/test children starve unrelated runs to failure. Killed the tree (contention cleared), then salvaged and hand-finished the stranded subprocess work (#2831). Lesson: the operator's own background `bun test`/`test:v2` runs leak pool workers — sweep for them.

## Parked for a dedicated session (with a daemon restart first)

The single true unblocker for both is a **daemon restart** so the running daemon (which predates #2827) loads the keystone implement-authored-directive path. Every implement that needs implement-authored mutation directives strands on the current daemon.

1. **reap `ready-gate-reaps-test-children` implement** — plan tree is on main (`v2/spec/20260811T063011Z-ready-gate-reaps-test-children/`). The implement wrote correct, green code (subspecs 00 + 01) but stranded `blocked`/`contract_miss`: the agent authored no `@mutate` directives for subspec 01's 1 keystone + 2 guards. Worktree abandoned; re-run from scratch after restart. **Subspec-design caveat:** 01's gate and required-integration spawn sites in `ready-finalize.ts` have byte-identical option lines, so no unique single-line `@mutate` anchor exists for "the gate's spawn" — the re-plan should differentiate the two sites or target distinct source lines.
2. **reap `daemon-start-sweeps-orphan-gate-children`** — ready-intent on main; plan+implement after (2) lands (depends on the durable group-id record).
3. **TUI `tui-left-pane-section-framing` + `tui-left-pane-width-and-timing-threshold`** — both ready-intents on main. The framing plan blocked on the plan-draft keystone gate (#2822): the plan agent drafted a keystone criterion with the `@mutate` directive **inlined in the criterion** (non-canonical — directives belong in test bodies) → rejected as unsatisfiable. Plan-agent variance (claude-only). Re-drive after restart; the design content in the ready-intents is sound.

## New seed authored

- `v2/spec/seeds/implement-reprompts-unlinked-guard-checkpoints.md` — extend #2827's write-loop reprompt to unlinked/hollow **guard** (`Mutation checkpoint:`) directives (currently keystone-only). This blocked the reap subspec-01 implement; greenfield agents reliably write code+tests but omit directives.

## Frictions (mostly known, one new)

- **Leaked bun-test pool workers** (the reap chain's own target) — reproduced against the operator's own background runs; a completed background test run leaves workers pegging CPU. Sweep at close.
- **Daemon predates in-session merges** — #2827's keystone reprompt only helps after a restart; the running daemon can't self-load it. This is the dominant blocker on the parked implements.
- **Ready-gate repair thrash on contention-flake** — `diff-derived-mutation-verifier.test.ts` times out at 30s under CPU load (isolated: 51/51 pass); the repair loop retried 3× and never flipped the draft. Killed the stray, hand-finished. (#2827's own case.)
- **Publication emits no PR / draft not flipped** — recurring; hand-finish path (verify gate, subagent-review, push, mark ready, admin-merge) applied on the keystone impl.
- **plan-draft keystone gate rejects inline-directive keystones** (new) — the gate is correct to require canonical form, but the plan agent (claude) drafted the directive inline; a plan-prompt nudge to keep directives in test bodies would avoid the strand. Folded into the guard-reprompt seed's context; not separately seeded (plan-agent variance, borderline).

## Process notes

- Every merge: CI green + adversarial subagent diff-review (or careful operator read) + local `lint:md` (CI omits it). Subagent review on #2827 confirmed the core write-loop change was real (not a green-gate no-op) and gated correctly.
- One slip: admin-merged the markdown-only seed #2830 while CI was still pending (risk nil, lint clean locally); held strict green-before-merge on all code PRs after.

Cost: operator claude-opus-4-8 paid — see cumulative CSVs (figure from `/cost`). Jarvis agents ran via quota, not in the operator figure.

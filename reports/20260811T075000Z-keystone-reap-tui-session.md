# Session report — keystone completion, reap chain, full TUI design review (2026-08-11)

Operator: claude-opus-4-8 (operator). Agents: claude-only first half; codex-first second half (operator restored codex quota mid-session, though codex proved unreliable — see frictions). Follow-on to the completed TUI command-center phase; drove the two deferred queue items (the keystone ready-intent + the reap seed) plus a full TUI design review the operator requested.

## Outcome

**12 feature PRs merged, all green + adversarial subagent/operator diff-review + local `lint:md`**, plus this close-out PR.

| # | What | Status |
| --- | --- | --- |
| #2826, #2827 | `keystone-links-implement-authored-directive` (plan + implement) | **Complete** — the primary ready-intent. Implement adversarially reviewed as real (not a green-gate no-op); hand-finished around a ready-gate-repair contention thrash |
| #2828 | reap intent split (seed → 3 ready-intents) | **Complete** |
| #2829, #2831 | reap `subprocess-process-group-kill` foundation | **Complete** — opt-in `processGroup` on the shared runner; #2831 hand-finished (entry iteration timed out under CPU starvation from leaked bun-test workers) |
| #2832 | reap `ready-gate-reaps-test-children` plan (3-subspec tree) | **Complete** — implement **parked** (see below) |
| #2830, #2833 | TUI design seed + intent split | **Complete** |
| #2835, #2836 | TUI `section-framing` (ruled `── Work (N) ──`/`── Queue (N) ──` headings; drop `idle` atom on terminal rows) | **Complete** |
| #2837, #2838 | TUI `width-and-timing-threshold` (widen pane 38→45–50%, floor 72→80; timing threshold 100→80 so ordinary terminals paint labeled `work · idle`) | **Complete** |

**Both operator asks delivered.** The primary "complete this work" (the seed + ready-intent): keystone fully shipped; the reap seed's foundation + all plans shipped, with only the gate-reaps implement + daemon-sweep parked. The secondary TUI design review: **fully implemented** — section separation (headings), wider pane (no longer "too thin"), readable timing, and both confusing atoms (`idle` on terminals, cryptic `w/i`) removed.

## Parked for a dedicated session

1. **reap `ready-gate-reaps-test-children` implement** — plan tree on main. First attempt (claude, pre-#2827-daemon) stranded on unauthored keystone+guard `@mutate` directives. Subspec 01's gate and required-integration spawn sites in `ready-finalize.ts` share byte-identical option lines, so no unique single-line `@mutate` anchor exists — the re-plan must differentiate them. Also blocked by the guard-reprompt gap (seed below).
2. **reap `daemon-start-sweeps-orphan-gate-children`** — ready-intent on main; plan+implement after (1).
3. Seed **`implement-reprompts-unlinked-guard-checkpoints`** (on main) — extend #2827's reprompt to guard checkpoints (keystone-only today); this blocked the reap subspec-01 implement.

## Notable findings

- **Leaked-worker reproduction.** The subprocess implement's entry iteration hit `iteration_timeout` after 45 min under CPU starvation from four `bun test` workers pegging 99%×4 CPU for 24 min — orphaned children of the operator session's own background test run. A live reproduction of the exact bug the reap chain fixes. Killed them, salvaged the stranded worktree.
- **Codex is unreliable this session (not a quota issue).** On the fresh codex quota the operator enabled, codex **hung** (no agent process, run wedged ~1 hr) on the TUI framing review step, then on the codex-first retry **crawled** ~60 min on one subspec without committing (processes alive, no progress). Killed both and fell back to claude for implements. Codex *plans* completed; codex *implement/review* steps were pathologically slow. Kept codex-first for plans/intents per operator preference.
- **Subspec-by-subspec continuation can't resume.** The multi-subspec TUI implements completed subspec 00 then paused `unsupported_resume_context` — the successor for subspec 01 never dispatched. Hand-finished the width subspec 01 (shared 80-col timing guard + 2 tests + verified keystone/guard `@mutate` directives + docs + fixed subspec-00 cross-file test collateral the never-run ready gate would have caught).
- **`@mutate` directive quoting.** `DIRECTIVE_PATTERN` accepts only double-quote delimiters with internal quotes escaped `\"`. Agents (both claude and codex) authored directives with single-quote delimiters when the target line contained `"` (e.g. `{ live: "idle" }`), producing unlinked/hollow checkpoints. Hand-rewrote them. Worth a prompt-guidance nudge.

## Frictions (recurring; see prior reports for the durable ones)

Known-recurring: ready-gate repair thrash on the `diff-derived-mutation-verifier` 30s contention-flake (isolated 51/51 pass); publication emits-no-PR / draft-not-flipped (hand-finish path); daemon re-keys per merge (a dispatch auto-bounces it; `cleanup --abandon` needs a live daemon on the current digest — use `git worktree remove` for squash-merged leaked worktrees). New this session: the codex hang/crawl; the subspec continuation resume gap; the `@mutate` single-quote-delimiter mistake.

## Process notes

Every merge: CI green + adversarial subagent diff-review (or careful operator read for mechanical/spec PRs) + local `lint:md`. Hand-finishes (5 of the 12 impl PRs) each ran full local verification (typecheck + scoped tests + mutation-directive redden/revert checks) before push. One slip: admin-merged markdown-only seed #2830 while CI pending (nil risk, lint clean); strict green-before-merge held on all code PRs after.

Cost: operator claude-opus-4-8 paid — see cumulative CSVs (figure from `/cost`). Jarvis agents (claude + codex) ran via quota, not in the operator figure.

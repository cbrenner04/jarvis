# Session 2026-09-18/19: seventeen implementations landed, and the tmpdir was the flake

Operator session 2026-09-18 ~09:10 CDT → 2026-09-19 ~10:10 CDT (Opus 5), Jarvis-on-Jarvis, agent order `claude` only. A machine power-off overnight idled lanes. **17 implementation PRs merged**, seven of them P0; the brief's P0 table dropped from nine rows to five. Chain B links 1–2 landed and the daemon re-drove a slot refusal in production without the operator.

## What landed

| PR | What |
| --- | --- |
| [#4046](https://github.com/cbrenner04/jarvis/pull/4046) | Stage success reopens provisional skipped successors (chain A head) |
| [#4048](https://github.com/cbrenner04/jarvis/pull/4048) | **P0** Built-in ready-gate autofix is best-effort on unfixable lint (hand-finished after a false `ready_gate_out_of_scope`) |
| [#4056](https://github.com/cbrenner04/jarvis/pull/4056) | Durable gate-refusal recovery state (chain B head) |
| [#4058](https://github.com/cbrenner04/jarvis/pull/4058) | CLI flushes stdout/stderr before exit (piped JSON truncated at 64 KiB) |
| [#4060](https://github.com/cbrenner04/jarvis/pull/4060) | Daemon-changeover rebind tests wait on events (hand-finished) |
| [#4061](https://github.com/cbrenner04/jarvis/pull/4061) | **P0** Rebased lane publishes with a lease authorized by the recorded pre-rebase SHA |
| [#4063](https://github.com/cbrenner04/jarvis/pull/4063) | **P0** Owning daemon writes the invocation settled marker (chain head) |
| [#4065](https://github.com/cbrenner04/jarvis/pull/4065) | **P0** Render-observer budget derives from the measured baseline |
| [#4067](https://github.com/cbrenner04/jarvis/pull/4067) | Terminal publication runs the real ready gate (every pipeline `ready`/`merge` terminal action had failed since July) |
| [#4068](https://github.com/cbrenner04/jarvis/pull/4068) | Tests remove every temp dir they create, plus a structural guard (fixed, not seeded) |
| [#4069](https://github.com/cbrenner04/jarvis/pull/4069) | Verifier process groups are killed when the owner is signalled (production leak, 7 GB orphans) |
| [#4070](https://github.com/cbrenner04/jarvis/pull/4070) | Daemon rebind admission race (Bun accepts before the listen callback); private-endpoint admission gated on the public bind |
| [#4071](https://github.com/cbrenner04/jarvis/pull/4071) | Bind-window test made deterministic |
| [#4072](https://github.com/cbrenner04/jarvis/pull/4072) | **P0** `run-ad-hoc-terminal` derives from the settled marker, notifies once per marker write (spec amended to key on `settledAt`) |
| [#4073](https://github.com/cbrenner04/jarvis/pull/4073) | **P0** Ready-gate repair fence reverts only repair-changed refused paths, binary-safe, via a pre-repair snapshot |
| [#4074](https://github.com/cbrenner04/jarvis/pull/4074) | Daemon auto-redrives slot-refused gate refusals (chain B link 2; verified in production 2026-09-19: a `slot_redrive` event re-drove prompt-targets) |
| [#4076](https://github.com/cbrenner04/jarvis/pull/4076) | **P0** Gate-allowset derivation over external and empty spec scopes (#3423, #4004) |

Spec, plan, intent and seed PRs: #4031–#4036, #4038–#4045, #4047, #4049–#4055, #4059, #4062 (brief's false "every implement PR" claim corrected to measured rates), #4066, #4075, #4077 (fence-derivation lane owns named reasons, fixing a scope gap I introduced). Closed unmerged: #4037, #4057 (plan PRs subsumed), #4064 (seed superseded by the direct fix #4068). Archive PR #4078 (9 specs) open for the operator.

## Review record

**6 of 17 implementation PRs carried a defect the gates passed** (5 real, 1 weak test). 2026-09-17 was 3/5; the rate is lower but not zero, and every catch was on daemon or publication code.

- **#4060**: shipped a masking `daemon_superseded` retry and self-ticked a false "5 consecutive passes" criterion (still 3/5 under load). Hand-finished; two criteria unticked at archival.
- **#4061**: three review rounds: stale `ORIG_HEAD` as the lease source, restamp before admission, then rebase.
- **#4065**: a fail-open window near the deadline, closed in review.
- **#4067**: review added process-group recording, signal forwarding, and `readyCommand` honoring.
- **#4073**: review caught data loss of operator work (fence reverted paths the repair never touched), then binary corruption in the revert.
- **#4058**: weak test (does not falsify the flush at the pipe boundary); harmless, recorded.

## Friction

- **Tmpdir was the flake.** The OS tmpdir held ~1.02M leaked jarvis test dirs; bun took 6–13 s to start scripts from it, causing false gate reds (`daemon-dead-socket-reclaim`, false out-of-scope). One-time cleanup removed 799,555 entries older than 24 h; #4068 prevents recurrence.
- **Orphaned mutants.** `while(true)` mutant test processes reached 2–7 GB each; fixed by #4069.
- **Memory hold during cleanup.**
- **Conflicting PRs run no CI**, silently: a conflict looks like pending checks.
- **Slot-contention treadmill:** ~10 hand resumes before #4074.
- **One green CI proves little for flaky tests.** Rule adopted: two green CI runs pinned to `headSha` for daemon or publication PRs.
- **Operator mistakes (mine):** merged pipeline plan PRs early, which deleted plan branches and stranded every pipeline implement stage (all pipelines dismissed); piped `lint:md` through `tail` and merged #4051 on a masked failure (verified harmless afterwards); read an old CI run as the current head's (now pinned to `headSha`); tightened a spec with a non-existent `stepIndex` column (settled-marker 01 decision corrected in this PR to the snapshot's step-0 `stepId`); cut the named-reasons subspec from the gate-allowset plan without an owner (fixed #4077).

## Cost

**Operator $186.50** (opus-5; 1h 48m 5s API across 1d 4h 32m wall; 144.6k in / 609.9k out with 264.3m cache read, 5.3m cache write, 99% of input from cache; haiku-4-5 $0.0032; +496 / −58 lines) **plus agent $54.25** = **$240.75** for the session.

Agent (`~/.jarvis/telemetry.jsonl`, `ts` ≥ 2026-09-18T14:00Z): **120 invocations, $54.25**, 21.7 h agent time; 67 sonnet-5, 53 opus-5; 109 `ok`, 10 `error`, 1 `stall`; 11 null-cost rows. Roles: implement 38, actuator 17, adversary/advocate/adjudicator 15 each, shrink 10, plan 8, critic 2. Implements for #4046/#4048/#4056 ran before the window; #4068–#4071 were operator-direct.

| Lane | Cost | Inv |
| --- | --- | --- |
| redrive-slot-refused-gates (#4074) | $9.87 | 14 |
| ready-gate-repair-fence-revert-and-settle (#4073) | $6.02 | 9 |
| owning-daemon-writes-invocation-settled-marker (#4063) | $5.06 | 12 |
| run-ad-hoc-terminal-derives-from-settled-marker (#4072) | $4.63 | 6 |
| daemon-changeover-rebind-test-flakes-under-load (#4060) | $3.35 | 9 |
| render-observer-verification-keeps-a-fixed-deadline (#4065) | $3.07 | 7 |
| persist-gate-refusal-recovery-state (#4056) | $3.00 | 6 |
| rebased-lane-publishes-with-lease (#4061) | $2.66 | 7 |
| cli-flushes-stdout-before-exit (#4058) | $2.66 | 7 |
| gate-allowset-derivation-handles-external-and-empty-spec-scope (#4076) | $2.13 | 7 |
| plans (5 branches) + fence-derivation plan | $10.57 | 26 |
| intents (2) | $1.24 | 6 |
| linked-routing, prompt-targets (killed at close; null cost) | $0.00 | 4 |

## Open at close

- **Resumable lanes, killed at closeout with committed work:** `20260918T111002Z-linked-implement-routing-settles-a-real-outcome` (resume run 80e3af5b or re-dispatch implement); `20260918T214241Z-ready-gate-repair-prompt-targets-failing-step` (run ec31333e).
- **Planned, not implemented:** `publication-failures-settle-failed-writer`, `branch-resume-admits-skipped-successor-lane`, plus the two above.
- **Ready-intents:** `fence-derivation-failure-settles-honestly` (re-plan next; scope gap fixed #4077); `report-gate-refusal-causes` (chain B link 3, unblocked by #4074); held: `detach-admission-refuses-without-a-run-row`, `publication-failure-rows-migrate-failed` → `failed-publication-consumers-drop-completed-special-case`, `branch-resume-refusal-names-blocking-row`.
- **Seeds this session:** `daemon-changeover-rebind-test-flakes-under-load` (#4049, landed #4060, spec archived here); `cli-json-output-truncated-at-pipe-buffer` (#4054, landed #4058).
- **Pipelines:** all dismissed. Lesson: don't merge a pipeline's plan PR before its implement stage dispatches.
- **Spec correction:** settled-marker 01 `stepIndex` wording corrected in place in this PR (dir still at its pre-#4078 path on `main`).

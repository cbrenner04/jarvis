# Session 2026-09-29→30: structural recovery, self-handoff and republication wedges

Operator session 2026-09-29→2026-09-30 (Opus 5.5), Jarvis-on-Jarvis, agent order led by cursor Composer 2.5. **48 PRs landed** (32 fixes/implements, 10 seeds, 6 config/spec/docs) plus 12 intent/plan PRs. Self-handoff wedges, harness-ready republication, false cursor quota, and draining-generation claims all closed; issue #3433 closed (by design, #4171). Late landings: [#4190](https://github.com/cbrenner04/jarvis/pull/4190) (pipeline-resume preflights, hand-finished), [#4234](https://github.com/cbrenner04/jarvis/pull/4234) (review-feedback lane admission, hand-finished), [#4172](https://github.com/cbrenner04/jarvis/pull/4172) (TUI retained pipeline list; operator force-push then fresh implement run).

## Fixes and implements

| PR | What |
| --- | --- |
| [#4168](https://github.com/cbrenner04/jarvis/pull/4168) | Reconcile the external-worktree `node_modules` link |
| [#4173](https://github.com/cbrenner04/jarvis/pull/4173) | Open new session logs in month shards |
| [#4174](https://github.com/cbrenner04/jarvis/pull/4174) | Direct fix: git 2.56 broken-gitfile diagnostic is not-a-repo |
| [#4180](https://github.com/cbrenner04/jarvis/pull/4180) | Repair-exhausted error names site and killing set |
| [#4185](https://github.com/cbrenner04/jarvis/pull/4185) | Swallow agent stdin EPIPE on early child exit |
| [#4186](https://github.com/cbrenner04/jarvis/pull/4186) | Pipeline resume resumes a resumable implement row in place |
| [#4188](https://github.com/cbrenner04/jarvis/pull/4188) | Configure hot and cold session-log retention |
| [#4191](https://github.com/cbrenner04/jarvis/pull/4191) | Publication-time non_terminating_mutation_failed names its site |
| [#4194](https://github.com/cbrenner04/jarvis/pull/4194) | Never signal or record the daemon's own process group |
| [#4197](https://github.com/cbrenner04/jarvis/pull/4197) | Cursor quota classified from stream-json |
| [#4200](https://github.com/cbrenner04/jarvis/pull/4200) | Self-handoff successor startup tolerates loaded-machine readiness latency |
| [#4203](https://github.com/cbrenner04/jarvis/pull/4203) | Handoff rollback restores admission after handoff-origin supersede |
| [#4208](https://github.com/cbrenner04/jarvis/pull/4208) | Capture open-PR review threads into a durable artifact |
| [#4209](https://github.com/cbrenner04/jarvis/pull/4209) | Preset registry marks standalone-only workflows |
| [#4211](https://github.com/cbrenner04/jarvis/pull/4211) | Git fixture template disables background maintenance |
| [#4214](https://github.com/cbrenner04/jarvis/pull/4214) | Reap SIGTERM-ignoring fixtures in subprocess timeout tests |
| [#4216](https://github.com/cbrenner04/jarvis/pull/4216) | Run resume claims terminal rows from a live draining generation |
| [#4220](https://github.com/cbrenner04/jarvis/pull/4220) | Stable decision verbs claim through terminal durable_state owner witness |
| [#4223](https://github.com/cbrenner04/jarvis/pull/4223) | Age session logs through hot, cold, and gone |
| [#4224](https://github.com/cbrenner04/jarvis/pull/4224) | Pipeline stage re-dispatch continues a clean committed lane when base moves |
| [#4227](https://github.com/cbrenner04/jarvis/pull/4227) | Retiring sole daemon self-heals admission |
| [#4229](https://github.com/cbrenner04/jarvis/pull/4229) | Persist harness ready-flip evidence on run rows |
| [#4231](https://github.com/cbrenner04/jarvis/pull/4231) | Terminal publication records a successful ready flip |
| [#4233](https://github.com/cbrenner04/jarvis/pull/4233) | Completion republication re-drafts harness-ready PRs |
| [#4235](https://github.com/cbrenner04/jarvis/pull/4235) | Test: 10 ms connect budget test deterministic |
| [#4236](https://github.com/cbrenner04/jarvis/pull/4236) | Run resume claims terminal rows from a live draining generation (follow-up) |
| [#4237](https://github.com/cbrenner04/jarvis/pull/4237) | Write-loop checkpoints never commit materialized `node_modules` |
| [#4239](https://github.com/cbrenner04/jarvis/pull/4239) | Completion commit falls back to branch Jarvis-Agent trailer |
| [#4242](https://github.com/cbrenner04/jarvis/pull/4242) | Autonomous self-handoff backoff retry after rollback |

## Seeds

| PR | What |
| --- | --- |
| [#4176](https://github.com/cbrenner04/jarvis/pull/4176) | reopened implement rolls up killed without review row |
| [#4177](https://github.com/cbrenner04/jarvis/pull/4177) | run resume refused while draining generation owns terminal row |
| [#4183](https://github.com/cbrenner04/jarvis/pull/4183) | cursor false quota; harness-owned agent shell tool |
| [#4187](https://github.com/cbrenner04/jarvis/pull/4187) | harness-exposed agent toolset; retire v2 nomenclature |
| [#4195](https://github.com/cbrenner04/jarvis/pull/4195) | failed self-handoff leaves daemon refusing work |
| [#4202](https://github.com/cbrenner04/jarvis/pull/4202) | apply PR review feedback to a lane |
| [#4206](https://github.com/cbrenner04/jarvis/pull/4206) | pipeline stage addresses review feedback |
| [#4210](https://github.com/cbrenner04/jarvis/pull/4210) | pipeline decision claim misses draining generation |
| [#4213](https://github.com/cbrenner04/jarvis/pull/4213) | pipeline stage re-dispatch rebases onto moved base |
| [#4225](https://github.com/cbrenner04/jarvis/pull/4225) | republication re-drafts the PR its lane flipped ready |

## Config, spec, docs

| PR | What |
| --- | --- |
| [#4156](https://github.com/cbrenner04/jarvis/pull/4156) | config: home on Opus 5.5 / Sonnet 5.5 / gpt-6.1-sol |
| [#4159](https://github.com/cbrenner04/jarvis/pull/4159) | spec: retire false-premise run-resume refusal intents |
| [#4171](https://github.com/cbrenner04/jarvis/pull/4171) | spec: stale-reset gate 2 stays in-root by design (closes #3433) |
| [#4192](https://github.com/cbrenner04/jarvis/pull/4192) | spec: address #4187 review |
| [#4201](https://github.com/cbrenner04/jarvis/pull/4201) | runbook: recover through jarvis first |
| [#4204](https://github.com/cbrenner04/jarvis/pull/4204) | intent: apply-pr-review-feedback-to-a-lane |

Intent/plan PRs: [#4157](https://github.com/cbrenner04/jarvis/pull/4157) [#4158](https://github.com/cbrenner04/jarvis/pull/4158) [#4160](https://github.com/cbrenner04/jarvis/pull/4160) [#4178](https://github.com/cbrenner04/jarvis/pull/4178) [#4181](https://github.com/cbrenner04/jarvis/pull/4181) [#4184](https://github.com/cbrenner04/jarvis/pull/4184) [#4196](https://github.com/cbrenner04/jarvis/pull/4196) [#4212](https://github.com/cbrenner04/jarvis/pull/4212) [#4218](https://github.com/cbrenner04/jarvis/pull/4218) [#4226](https://github.com/cbrenner04/jarvis/pull/4226) [#4238](https://github.com/cbrenner04/jarvis/pull/4238) [#4240](https://github.com/cbrenner04/jarvis/pull/4240).

## Friction

- `jarvis cleanup` never retires plan-stage worktrees: `checkEligibility` (`v2/src/commands/cleanup.ts:283`) requires the branch's own PR `MERGED`, but pipeline plan PRs are closed as subsumed by the implement PR; merged implement lanes also stayed (likely non-terminal run-row gate). 22 landed worktrees left for manual `--abandon`. Seed candidate.

- Harness republished two already-merged lanes as duplicate PRs (#4243 dup of #4191, #4244 dup of #4236; closed). Likely the restart-recovery zombie rows. Seed candidate.
- Run c47fa220 (#4172) settled `killed` with `loopOutcomeKind: complete` — 4th false-killed rollup.

- cursor tool-wrapper shells spun at ~90% CPU; operator killed them.
- False cursor quota escalated to paid rungs (fixed #4197).
- Daemon SIGTERM self-reap of its own process group (#4194).
- Self-handoff wedged at `daemon_superseded`; four fixes (#4200 #4203 #4227 #4242).
- Notification waits missed events → ~1h idle, twice. Stale notification backlog.
- Harness-flipped-ready PR blocked republication 4× (fixed #4229 #4231 #4233).
- Stale-reuse after main moved (#4224); `pipeline_no_live_owner` (#4220); `owner_alive` (#4216 #4236).
- False `killed` rollup 3× (seeded; pipeline c1d2db5f still open).
- `closed database` test flake ×2; repair agent chased out-of-diff flaky tests.
- IPC connection lost during handoffs.
- "completion attribution is missing" (#4239).
- Run log lacks the failing gate step.
- Operator hand-push left a foreign tip.
- intent-output ENOENT (fixed).
- Mutation-repair misattribution; mutation gate false positives: survivor reported 46 min after the killing test was committed (#4233); "non-terminating" verdicts on slow-but-killed mutants (#4234 `workflow.ts:208`) and on a stale line (#4190).
- Daemon restart-recovery marked rows `resumed` but never ran them → in-progress/not-live for 13h (82334874, a9233ed4; dismissed).
- `pipeline dismiss` of full id bb738352 refused `pipeline_id_set_incomplete` persistently.
- Primary checkout not pulled, so the daemon stayed on an old digest.
- ≥8 plans needed hand-correction before approval (evidence added to seed `review-roles-check-falsifiability-not-plausibility`).
- Classifier blocked a bundled rerun+merge script.
- 46 orphan node processes from `shared/subprocess.test.ts` (#4214 fixed the leak).

## Open at close (carry forward)

- c1d2db5f: reopened-implement lane held on sibling.
- 96f57442: review-feedback chain; capture-pr-review-input and non-pipeline-preset lanes failed gates.
- f13b29a3: retention telemetry lane.

## Cost

| | Cost | Notes |
| --- | --- | --- |
| Operator (`/cost`) | $157.54 | claude-opus-5-5 (3h12m API, 16h59m wall) |
| Agents (telemetry) | $79.39 | 433 invocations; cursor Composer 2.5 $31.03/284, codex gpt-5.6-sol $14.94/36, claude-opus-5 $12.39/18, claude-sonnet-5 $10.22/12, claude-opus-5-5 $5.75/15, claude-sonnet-5-5 $4.70/20, codex gpt-5.6-terra $0.36/24, gpt-6.1-sol/gpt-6-luna $0 (unpriced)/24 |
| **Total** | $236.93 | 32 fixes/implements → $7.40 per landed fix |

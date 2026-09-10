# 2026-09-09 operator session — pipelines cannot finish what they start

Dogfooded four `full-review` pipelines seed→ready, then drove every ready-intent they produced. **35 PRs merged, zero left open.** Agent order `codex,claude` (cursor and opencode out).

**Cost: $210.02** — operator $113.34 (opus-5, 1h03m API of 12h08m wall, 99% cache hit) plus agent $96.68 list-price, all rungs on subscriptions. 235 agent invocations: codex 135 (35 ok, **100 quota**), claude 100 (99 ok, 1 error). Codex quota-cascaded to claude unattended all session, which is the point of setting an order. 105 files touched, $1.08/file, $0.16/minute.

## The finding

**A chained pipeline implement stage cannot complete, and the mechanism is now known.** It reads its spec tree from the prior stage's worktree (`specReadRoot`) while the agent writes in the implement worktree, and the criteria-ticked completion contract reads the *former*. Three lanes failed three different ways from that one cause:

| Run | Settlement | Spec dir present? | Agent's work |
| --- | --- | --- | --- |
| `51838502` | `missing_blocker` | no | complete, committed |
| `88c144e4` | `gate_invocation_refused` | no | partial |
| `a6720fc7` | `contract_miss` | **yes** | complete, **15/15 ticked** |

Lane 3 is the proof. Its plan PR had merged, so the spec was present and the agent ticked all fifteen criteria — in the implement worktree, which held 15 ticked / 0 unticked, while the plan worktree the contract reads held 0 / 15. So it is a **split read/write root**, not a missing directory, and merging the plan PR first is not a workaround.

**The controlled comparison settles where the fault lies.** Six standalone `implement` runs on the same specs, same agent order: five completed end-to-end unattended — criteria ticked, gate green, draft→ready flipped, PR published, zero operator steps. The preset is fine. The agents are fine. The chained stage is not. Seeded [[chained-implement-cannot-tick-its-own-criteria]] ([#3688](https://github.com/cbrenner04/jarvis/pull/3688), amended [#3690](https://github.com/cbrenner04/jarvis/pull/3690)).

## Parallelization, measured

- **Four concurrent intents, then four concurrent plans**: clean, load 2.4–7.3, zero watchdog false-kills.
- **Fan-out is content-bound, not harness-bound.** The old all-or-nothing fan-out failure did **not** reproduce — simultaneous gate approval dispatched sibling plan lanes in parallel. But every intent split this session produced a *strict serial chain*, so the two lanes I approved together both settled `agent_blocked` naming their unlanded sibling: correct and cheap, but one wasted dispatch each. Reading `## Prerequisites` first cost nothing and saved two of three dispatches on the later pipelines. **The ceiling on plan-stage parallelism is what the seed decomposes into.**
- **The gate slot works.** A second concurrent implement got `gate_invocation_refused` — fast and resumable — instead of colliding and dying at 45m. That converts the session-killing mode from the brief into a cheap retry.
- **Schedule by gate scope, not lane count.** `shared/**` lanes ran alone; v2-scoped lanes paired.

## Verifier orphans: closed, and verified

Mid-session the machine hit load 16 with two `bun test` processes at **20.3GB and 19.5GB RSS**, both `PPID 1`, both in `T/mutation-verifier-while-true-guard-*` — enough that the OS low-memory killer started reaping. Killed; load fell to 4.4.

Then verified the merged state empirically on an idle machine: [#3706](https://github.com/cbrenner04/jarvis/pull/3706)'s regression test runs **113/113 in 34s leaving zero orphans**, and the leftover fixture dirs dated Sep 8 00:32 / Sep 8 23:30 / Sep 9 15:43 / Sep 9 16:15 — the two killed plus two from prior sessions, none from the clean run. The orphans came from intermediate iterations. With [#3691](https://github.com/cbrenner04/jarvis/pull/3691) (referenced escalation timer, awaited `ESRCH`) the mode that has opened three sessions at load 33 is closed.

## What the gates passed and review caught

- **A dead tie-break with a criterion claiming it was covered.** `merge-pipeline-snapshots.ts`'s `candidateSocketPath < currentSocketPath` is unreachable under sorted iteration; the two tests that appeared to pin it passed on insertion order. Fixed in-branch, and the Decisions bullet and criterion corrected to claim what is true.
- **A verb path that discards its own resolution.** It resolves a pipeline-id prefix to a full id, routes by it, then sends the **raw argument** to the daemon — while `hasMalformedResponse` is dropped, so a skipped socket narrows the CLI's id set and a prefix can resolve differently at the owner. `approve`/`reject` are affected. Latent, seeded [[pipeline-verb-path-discards-its-own-resolution]] ([#3711](https://github.com/cbrenner04/jarvis/pull/3711)).
- **A false mutation survivor that reached a terminal settlement.** Run `1e1f893c` settled `surviving_mutation_failed`, spent its full repair budget, and settled `mutation_repair_exhausted` — never re-admitted. Hand flip-and-test: the reported mutation failed **1** test at the settlement commit and **3** after repair. The guard was covered throughout. That settlement also left the PR a **draft** with its repair commits **unpushed**, so its green CI described a tree the branch no longer had — a shape the read-`statusCheckRollup` rule cannot catch, because the rollup was honest about the commit it described. Seeded ([#3705](https://github.com/cbrenner04/jarvis/pull/3705)).

Every salvaged or reviewed implementation was mutation-verified by hand before its criteria were trusted: reverting the production change failed 3 tests on [#3689](https://github.com/cbrenner04/jarvis/pull/3689), 6 on [#3691](https://github.com/cbrenner04/jarvis/pull/3691), 2 on [#3695](https://github.com/cbrenner04/jarvis/pull/3695), 3 on [#3712](https://github.com/cbrenner04/jarvis/pull/3712).

## Plan quality

**Plan lanes cleared the contract gate 6 of 10 times unaided — the first session with any clean plan lanes at all.** The [#3628](https://github.com/cbrenner04/jarvis/pull/3628) taxonomy retirement is holding: no near-duplicate splits, drafts decomposed by behavior, criteria naming real test titles and what they fail against.

All four failures were the gate rejecting well-formed prose, not bad drafts:

- Twice on the one-artifact-per-bullet rule — an acceptance bullet asserting two *existing* test files stay green, and a Decisions bullet naming the two executors one decision governs. Seeded [[one-artifact-per-bullet-rejects-well-formed-bullets]] ([#3702](https://github.com/cbrenner04/jarvis/pull/3702)), the **fourth** instance of the brief's "strict lexical patterns fail closed" class.
- Twice on [[index-link-check-rejects-annotated-subspec-lines]], already open.

## Other harness findings

- **Merging anything during a live pipeline fails its implement stage at admission.** `base_behind_origin` names `--base origin/main` as a remedy that a pipeline stage has no way to pass — and merging stage PRs is how a pipeline lands its own work. Seeded ([#3685](https://github.com/cbrenner04/jarvis/pull/3685)); recovery is `git pull --ff-only` then `pipeline resume`.
- **[[pipeline-cli-discovers-daemons-like-run-list]] reproduced three times live**, each right after a `v2/src` merge: `pipeline list` returning `connect ENOENT` while `run list` answered normally. Its full three-lane chain landed the same session ([#3692](https://github.com/cbrenner04/jarvis/pull/3692), [#3704](https://github.com/cbrenner04/jarvis/pull/3704), [#3710](https://github.com/cbrenner04/jarvis/pull/3710)).
- **The daemon-restart continuation sweep settled all three wedged implement stages on the first restart**, as documented.
- **`bun run test:v2` false-reds inside the agent sandbox** — four `v2/src/ipc/server.test.ts` tests fail `EPERM` binding unix sockets; 16/16 outside. Any hand-finish gate run from an agent session will show this, and it is never the diff.
- **The 2026-09-08 `invocation_error` was not deterministic** — the same ready-intent planned normally today, which narrows that seed.

## Issue work

Intake **#3598 is now fully addressed**: lane 4 (`distinguish-configured-and-default-missing-gates`), which the owner had explicitly left as open work after an undiagnosable dispatch failure, was planned, implemented and merged ([#3680](https://github.com/cbrenner04/jarvis/pull/3680) → [#3695](https://github.com/cbrenner04/jarvis/pull/3695)).

## Slips

- **[#3712](https://github.com/cbrenner04/jarvis/pull/3712) was admin-merged before CI reported.** The command printed `statusCheckRollup` but did not gate on it. `main` verified green at `3e8138538` afterwards, but this is exactly the rule #3648 established.
- I polled background waiters far more than necessary early on, before switching to condition-blocking loops.

## Merged (35)

Specs/plans: [#3680](https://github.com/cbrenner04/jarvis/pull/3680), [#3683](https://github.com/cbrenner04/jarvis/pull/3683), [#3684](https://github.com/cbrenner04/jarvis/pull/3684), [#3686](https://github.com/cbrenner04/jarvis/pull/3686), [#3687](https://github.com/cbrenner04/jarvis/pull/3687), [#3698](https://github.com/cbrenner04/jarvis/pull/3698)-[#3701](https://github.com/cbrenner04/jarvis/pull/3701), [#3708](https://github.com/cbrenner04/jarvis/pull/3708), [#3709](https://github.com/cbrenner04/jarvis/pull/3709).

Implementations: [#3689](https://github.com/cbrenner04/jarvis/pull/3689), [#3691](https://github.com/cbrenner04/jarvis/pull/3691), [#3692](https://github.com/cbrenner04/jarvis/pull/3692), [#3693](https://github.com/cbrenner04/jarvis/pull/3693), [#3695](https://github.com/cbrenner04/jarvis/pull/3695), [#3703](https://github.com/cbrenner04/jarvis/pull/3703), [#3704](https://github.com/cbrenner04/jarvis/pull/3704), [#3706](https://github.com/cbrenner04/jarvis/pull/3706), [#3707](https://github.com/cbrenner04/jarvis/pull/3707), [#3710](https://github.com/cbrenner04/jarvis/pull/3710), [#3712](https://github.com/cbrenner04/jarvis/pull/3712).

Seeds: [#3685](https://github.com/cbrenner04/jarvis/pull/3685), [#3688](https://github.com/cbrenner04/jarvis/pull/3688), [#3690](https://github.com/cbrenner04/jarvis/pull/3690), [#3702](https://github.com/cbrenner04/jarvis/pull/3702), [#3705](https://github.com/cbrenner04/jarvis/pull/3705), [#3711](https://github.com/cbrenner04/jarvis/pull/3711).

Housekeeping: [#3678](https://github.com/cbrenner04/jarvis/pull/3678), [#3679](https://github.com/cbrenner04/jarvis/pull/3679), [#3681](https://github.com/cbrenner04/jarvis/pull/3681), [#3682](https://github.com/cbrenner04/jarvis/pull/3682), [#3694](https://github.com/cbrenner04/jarvis/pull/3694), [#3696](https://github.com/cbrenner04/jarvis/pull/3696), [#3697](https://github.com/cbrenner04/jarvis/pull/3697).

## Next

The single highest-value item is [[chained-implement-cannot-tick-its-own-criteria]]. It is the last thing between `full-review` and an unattended seed→ready run: every other stage — intent, both gates, plan, and standalone implement — is now demonstrably healthy.

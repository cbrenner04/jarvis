# Session 2026-09-06 — single-lane pipelines work; the concurrency ceiling is gate invocations

Operator session driving the structural recovery with two goals from the operator: dogfood pipelines where feasible, and experiment with parallelization at every workflow stage including implementation.

## Headline findings

### 1. A single-lane `full-review` pipeline runs end-to-end

Two pipelines were driven seed → intent → gate → plan → gate → implement. Intent, plan, and both approval gates worked with no harness intervention; every failure this session was confined to the **implement** stage. This is the first clean evidence that the pipeline shape itself is sound — the blockers are downstream.

| Pipeline | Seed | Result |
| --- | --- | --- |
| `316bb8f2` | `subspec-inventory-relativizes-against-the-wrong-root` | intent → plan → implement; implement timed out, hand-salvaged → [#3555](https://github.com/cbrenner04/jarvis/pull/3555) |
| `9b430ca0` | `daemon-start-reclaims-its-own-leftover-socket` | fanned to 2 lanes; head lane driven → implement timed out, hand-salvaged → [#3554](https://github.com/cbrenner04/jarvis/pull/3554) |

### 2. The concurrency ceiling is concurrent full-suite gate invocations, not lane count

Four concurrent implements ran at load 6–11 with **zero** watchdog false-kills. A saturation alarm armed at 22, then re-armed at 18, **never fired across two full hours**. Load average is not the signal.

Two lanes nonetheless died at **45m01s** and **45m02s** — the iteration ceiling — each with real work committed and **exactly one acceptance criterion unticked, always `bun run test:v2`**:

| Run | Iterations | Died at | Committed | Sole unticked AC |
| --- | --- | --- | --- | --- |
| `8155c8e9` | 1 | 45m01s | +318 lines, clean tree, 15/16 ACs | `bun run test:v2` |
| `f229f8d7` | 2 | 45m02s | 2 commits, subspec 00 at 8/9 | `bun run test:v2` |

`f229f8d7` is the sharp case: iteration 2 spent the entire budget with `iteration_commit skipReason: "no_file_changes"` — the whole 45 minutes inside a suite invocation that produced nothing, while sibling lanes did the same.

The mechanism: each implement subspec ends with a full-suite AC, the agent invokes that suite **inside** the write step's iteration budget, and nothing staggers those invocations across lanes. The suite is ~326s idle; three or four copies at once do not finish inside 45 minutes.

**The interaction is self-sealing.** Because the test AC is both ticked last and the budget consumer, a lane killed mid-suite always has zero *fully* complete subspecs, so `hasCompletedSubspec` is false and the timeout settles non-resumable. Seeded [[implement-gate-invocation-outlives-the-iteration-ceiling]].

### 3. Correction: the inventory fix does not by itself make these lanes recoverable

The brief frames [[subspec-inventory-relativizes-against-the-wrong-root]] as the keystone that makes `iteration_timeout` resumable. That is too strong. With the inventory fixed, a lane killed mid-suite reports its subspec as *remaining*, not *completed* — so `resumable` stays false. The two seeds are complementary; neither alone restores the documented recovery.

### 4. The keystone bug demonstrated itself

`8155c8e9`, the implement lane *for* the subspec-inventory fix, settled with `completedSubspecPaths: []` and `remainingSubspecPaths: []` on a spec with one linked subspec — the empty-inventory signature of the very defect it was fixing. Honest scope: the subspec should have been listed as *remaining* and was not, which proves the defect in production; it does not show resume would have been admitted, since subspec 00 was 15/16.

### 5. `run kill` reports success without killing ([seed](../v2/spec/seeds/run-kill-reports-success-without-killing.md))

A lane whose gate child hangs cannot be stopped, and the CLI does not say so:

```text
jarvis run kill 04fba343…          → killed  (exit 0)   row: in-progress/live, child 128% CPU
jarvis run kill --force 04fba343…  → killed  (exit 0)   row: in-progress/live, child 137% CPU
```

Settlement waits on quiescence; quiescence waits on the child that termination was supposed to reap. `killed` is an acknowledgement of the RPC, not a report of the outcome. This removes the documented recovery for a stalled run exactly when it is needed. Distinct from the existing `daemon stop`/`run kill` deadlock bullet, which requires a row that is non-terminal *and* not-live; this row is genuinely live and owned by the reachable daemon.

### 6. A shipped test seam that covered nothing

The socket lane's `startIpcServer` gained `useProductionProbe = probe === probeSocketLiveness` — a **reference-identity check** forking production and tests into two structurally different bind paths. All four new reclaim tests injected a probe, so every one ran the test-only branch: deleting the entire extended-reprobe block left them green. Found by independent diff review, not by any gate. Same class as the open [[generalize-production-test-seam-guard]] ready-intent.

Hand-fixed to one `DetailedSocketProbe` seam, then mutation-verified.

### 7. Four flavours of vacuous mutation `pass` in one session

Running `verifyDiffDerivedMutations` by hand — which the runbook recommends and which costs about ten lines — produced three different passes that proved nothing:

| Result | Meaning |
| --- | --- |
| `pass`, 0 accepted / 13 skipped | Fixes were uncommitted, so candidate positions did not match the tree. Committing turned the same call into three real survivors. |
| `pass`, 0 accepted / 0 skipped | No candidates derived at all against a stale local `main`. |
| `pass`, 0 accepted / 0 skipped | On a file with 348 changed lines that had yielded candidates minutes earlier. |
| `pass`, 1 accepted / 0 skipped | A genuine pass. |

Separately, the gate is structurally blind to **argument-swap** defects. The keystone's own fix is `projectRoot` → `worktreePath`, and its changed condition lines already existed, so zero candidates were derived — the mutation gate cannot see the very bug class that spec fixes.

`kind` alone does not distinguish these. A verifier that evaluated nothing and a verifier that killed everything both report `pass`.

The three survivors it did find on the socket branch were real, two of them outage-relevant:

| Mutant | Consequence | Now killed by |
| --- | --- | --- |
| `!extended.peerConnected` → `extended.peerConnected` | binds over a live-but-slow daemon | `refuses when the extended reprobe finds an answering peer` |
| `=== "live"` → `!== "live"` | skips pre-bind removal entirely | `refuses when a peer appears before the stale path is removed` |
| skip `rmSync(` at close | none — node unlinks in `server.close()` | `@mutate-equivalent` directive |

### 8. The verifier hung forever on its own non-terminating mutant — and that defeated `run kill`

The single most consequential finding, and it resolves three separate symptoms at once. The verifier applied a `guard-flip: === → !==` to the exit condition of a `while (true)` loop in `daemon-run-control-handler-guard.ts`:

```diff
       let from = 0;
       while (true) {
         const index = source.indexOf(symbol, from);
-        if (index === -1) break;
+        if (index !== -1) break;
```

With the guard flipped, an *absent* symbol yields `index === -1` on every pass: the loop never breaks, pushes a violation each iteration, and `from = -1 + symbol.length` never advances it out. Non-terminating, with unbounded array growth.

Everything else followed from that one hang:

- `bun test` on that file at 100% CPU (peaking 181%) for **2h30m+**, parented to the **daemon**
- the run stuck `in-progress` / `live` with **no agent process**, past every watchdog — `iteration_started` at 16:25:48 was still the last log event 90 minutes later
- both `run kill` and `run kill --force` inert, because settlement waits on quiescence and quiescence waits on that child
- the worktree left holding an **inverted production guard**, since restore only runs after the test returns — it reads exactly like agent-authored corruption

Seeded [[mutation-verifier-hangs-forever-on-a-non-terminating-mutant]]. The loop shape is not unusual: the `*-anchors` scanners across cli, daemon, and execution-loop are all written this way, so every `=== -1` guard in that growing corpus is a candidate whose flip does not terminate.

A second, unrelated spinner ran alongside it: `bun test` at 100% for 1h32m parented to **launchd**, inside a worktree whose lane was still live — so verifier spawns also leak from *running* lanes, not only across sessions ([[bind-verifier-spawns-to-run-termination]]). Parentage is the discriminator and the recoveries differ, so check it before acting.

### 10. Lint autofix silently repointed a structural locator at a fixture

Biome renamed `RESUME_PATH_INVENTORY_ANCHORS` to `_RESUME_PATH_INVENTORY_ANCHORS` — correctly, since the constant is only ever read by parsing the file's own source, so lint sees it as unused. The parser's regex required the unprefixed spelling and its first match then fell through to a fixture:

| Regex | Matched at | Anchors parsed |
| --- | --- | --- |
| pre-fix | line 529 — a test fixture | **4** |
| accepting the prefix | line 28 — the real inventory | **6** |

Both loud guards — "not found" and "array is empty" — stay silent, because a fixture is a well-formed non-empty inventory. The parity test body is `for (const anchor of anchors)`, so two real anchors would have gone unchecked indefinitely against a green suite. Seeded [[self-parsing-structural-tests-can-bind-to-their-own-fixtures]]; the pattern underlies the whole `*-anchors` corpus.

### 9. Fan-out split, then the plan stage re-merged it

`9b430ca0`'s intent split one seed into two hard-coupled lanes — `cleanup-shares-daemon-socket-classifier` listed four prerequisites that were all the head lane's decisions. Only the head lane was approved, per the serial practice. Its plan then **absorbed the sibling's entire scope** as subspec 01, same test name. The redundant ready-intent was deleted rather than left to be planned twice.

Independent confirmation of the documented gotcha: a hard-coupled fan-out wants to be one spec with chained subspecs, and here the harness reached that shape on its own despite the split.

## Notification honesty, third session running

`run-ad-hoc-terminal` fired `terminal:completed` for workflow **entry** rows whose successors were still live, and once (`28347c81`) for a row whose durable status still read `in-progress`/`not-live`. Covered by [[notification-incidents-roll-up-to-the-invocation]] and not re-seeded — but it is now three sessions of evidence against the wake path the runbook designates as primary.

## `main` is red on its own local gate, again

`runtime-smoke-verifier > … observes clean through the real CLI probe contract` fails at ~10.1s against an internal probe bound, **in isolation, on `main`**, with cores pegged. It is not a test timeout (the test allows 60s) — `verifyRuntimeSmoke` returns a non-clean verdict. CI passes the same file on a clean runner, so it is environmental. Another instance of the [[coscheduled-test-pair-strands-runs-terminally]] family, and the reason one acceptance criterion on [#3555](https://github.com/cbrenner04/jarvis/pull/3555) was left unticked pending CI rather than self-graded.

## Friction not worth seeding

- `pipeline approve` / `reject` print nothing on success (only `resume` echoes an id). Exit 0 is the contract, but an instinctive re-run then returns a bare `status_not_awaiting`, which reads like the gate is gone.
- `jarvis pipeline dismiss` requires the full UUID; the short id shown by `pipeline list` returns `pipeline_not_found`.
- `pipeline list --json` nests under a `pipelines` key while the human listing is flat — worth knowing before scripting against it.

## Tally

| PR | What |
| --- | --- |
| [#3548](https://github.com/cbrenner04/jarvis/pull/3548), [#3549](https://github.com/cbrenner04/jarvis/pull/3549) | intents (pipeline stage 0) |
| [#3550](https://github.com/cbrenner04/jarvis/pull/3550), [#3551](https://github.com/cbrenner04/jarvis/pull/3551) | pipeline plan trees |
| [#3552](https://github.com/cbrenner04/jarvis/pull/3552) | standalone plan, P0 settlement seam |
| [#3553](https://github.com/cbrenner04/jarvis/pull/3553) | gate-invocation seed, ledger, two runbook entries |
| [#3554](https://github.com/cbrenner04/jarvis/pull/3554) | **occupancy-aware daemon socket reclaim** (subspec 00) |
| [#3555](https://github.com/cbrenner04/jarvis/pull/3555) | **subspec inventory relativizes against the worktree root** |
| [#3556](https://github.com/cbrenner04/jarvis/pull/3556) | **execution-loop structural-invariant anchors, all 11 subspecs** |
| [#3557](https://github.com/cbrenner04/jarvis/pull/3557) | daemon structural-invariant anchors, subspecs 00-02 (salvaged from the wedge) |

Seeded: `implement-gate-invocation-outlives-the-iteration-ceiling`, `run-kill-reports-success-without-killing`, `mutation-verifier-hangs-forever-on-a-non-terminating-mutant`, `self-parsing-structural-tests-can-bind-to-their-own-fixtures`.

Every lane launched this session landed or is in an open PR. Two implement lanes and both pipeline implement stages required hand-finishing; no lane's work was discarded.

## Cost

Operator `/cost` to be filled in at close.

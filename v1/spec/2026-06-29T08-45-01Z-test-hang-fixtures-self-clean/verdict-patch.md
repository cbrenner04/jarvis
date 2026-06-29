## Verdict: required refinements before merge

### Blocking

1. **Parent-death must watch the script’s immediate bash parent (the spawner), not the script process itself.**  
   Today `$PPID` is read inside the background watcher subshell, so it resolves to the script runner’s PID. That process stays alive for the entire stall (`exec tail`), so the poll never fires when the spawner dies and the helper is orphaned — the primary failure mode for `--bail`, operator interrupt, and cases where per-test teardown does not run.  
   **Required outcome:** In-scope hang scripts wired through `IDLE_HANG_WAIT` self-terminate within `__testKillGraceMs` (200) + headroom when the process that invoked the script is killed, while the stall body remains alive long enough to observe the exit.

2. **The parent-death acceptance test must prove that behavior, not pass vacuously.**  
   Spawning with `exec bash <script>` collapses wrapper and script into one PID; killing that PID terminates the helper directly, with or without parent-death logic. The checked AC (“immediate bash parent is killed”) is therefore not satisfied.  
   **Required outcome:** An isolated, sandbox-off subprocess test keeps a distinct parent and child (parent invokes the script without collapsing PIDs), kills only the parent, and asserts the helper subtree exits within `__testKillGraceMs` + headroom — without harness watchdog involvement.

### High

3. **Hang-fixture teardown registry must be safe under `bun run test` (`bun test --parallel`).**  
   `activeRegistry` is a module-global singleton shared across test files. Concurrent files each call `beginHangFixtureTracking()` / `reapActiveHangFixtures()` in hooks; interleaving can overwrite or clear another file’s registry, dropping registrations or reaping the wrong process trees. The spec’s dual-defense model explicitly covers parallel-file orphans; teardown is load-bearing when script self-clean is insufficient or races.  
   **Required outcome:** Per-test hang-fixture tracking and reap remain correct when multiple test files run concurrently — no cross-file registry corruption, dropped registrations, or erroneous kills.

### Not required for merge

- **Bounded-lifetime hook (3600s):** Present per spec deferral; no AC pins the bound. Acceptable as a long backstop until a consumer needs a tighter value.
- **`afterEach` without per-test `finally`:** Covers normal throw/early-exit (proven by the teardown AC). Belt-and-suspenders `finally` at spawn sites is optional once parent-death works.
- **Runbook stopgap removal:** No `*-hang.sh` orphan stopgap exists; conditional task is a no-op.
- **Preservation watchdog ACs, shared-compose wiring, teardown reap AC:** Structurally aligned; they depend on fixing #1, not rework.
- **Nits** (`HANG_FIXTURE_EXIT_DEADLINE_MS` derivation, `runAgent` await in teardown AC, `IdleHangAgent` relocation): quality improvements only.

### Rationale

The spec’s load-bearing decision is dual defense: script parent-death for abnormal exits where teardown may not run, plus per-test teardown as the primary path for normal abort. Parent-death is currently non-functional and unverified; the checked parent-death AC would pass without the feature. Until #1 and #2 are resolved, the implementation does not meet the spec’s core orphan-prevention goal. #3 is required so the teardown layer remains trustworthy under the repo’s default parallel test run.

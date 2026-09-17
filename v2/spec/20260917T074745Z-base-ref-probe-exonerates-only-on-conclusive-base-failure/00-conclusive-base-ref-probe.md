# Conclusive base-ref probe

`createDefaultReproduceReadyGateAtBaseRef` (`v2/src/execution/ready-finalize.ts`) returns `fail` on any non-zero exit (v2 mode: `aggregateExitCode(results) !== 0`), with no requirement that the output name the probed path as a failing test. `probeOutsidePathsAtBaseRef` treats every `fail` as confirmed-outside, so a non-test failure can exonerate a lane regression. Separately, `classifyReadyGateFailure` (lines 603–607) returns `ready_gate_out_of_scope` directly, without ever calling the probe, whenever it cannot parse a terminal failed test step or has no `scope` — the same "exonerate without a conclusive base failure" bug on a second code path.

## Decisions

- Root-cause first: before changing classification, establish why the probe reported `fail` for `v2/src/daemon/daemon-run-failure-capture.test.ts` (run `75ca2a7a`). Candidate cause: the v2-mode spawn path (`createWorktreeSpawn`) never receives `probeEnv`, unlike the non-v2 `bun` path — confirm or find the real cause and fix it in the probe. Rules out patching classification only while the probe keeps misreporting.
- No exoneration without a probe: when `classifyReadyGateFailure` cannot parse a terminal failed test step or has no `scope` (current lines 603–607), it settles repairable `ready_gate_failed`, not `ready_gate_out_of_scope`. Rules out treating "couldn't determine terminal step" as grounds for exoneration.
- A conclusive `fail` requires the probe's output to name the probed path as a failing test, not merely a non-zero exit. Rules out a timeout, a crash, or an unrelated command failure counting as reproduction. Exact result field carrying that evidence is deferred to first consumer — pin when the implementer sees which v2-mode result fields carry it.
- The probe-tree `HEAD`-vs-merge-base check is defensive only: `git worktree add --detach <sha>` either lands on that commit or throws, and a throw is already reported as `error` (inconclusive), so no reachable path to a silently-wrong tree is known. Add the check for defense-in-depth; do not require reproducing an "unverified tree" case in acceptance criteria.
- Everything else — a probe error, or a non-zero exit without test-failure evidence (including a probe timeout, since a timeout's output cannot name a failing test) — is inconclusive: the reproducer returns `{ kind: "error" }`, keeping the path in `inScopePaths` so the run settles repairable `ready_gate_failed` with `baseRefProbeError`. Rules out adding a new classification kind.
- No serial re-run before exonerating: a real base-tree test failure is accepted as sufficient evidence for `fail` even under concurrent lane load. Rules out adding retry-based mitigation — all three cited incidents (`75ca2a7a`, `823a8185`, `29b222de`) were deterministic lane regressions, not load-induced flakes, so a retry would add cost without addressing the observed failure mode.
- Scope: base-ref probe and the classification it feeds only; the ready gate command, tier, and test scope are unchanged.

## Task checklist

- [ ] Diagnose the `75ca2a7a` false `fail` and fix its cause in the default reproducer.
- [ ] Fix `classifyReadyGateFailure`'s no-terminal-step/no-`scope` path to settle `ready_gate_failed` instead of `ready_gate_out_of_scope`.
- [ ] Require test-failure evidence for `fail`; other non-zero exits (including a timeout) → inconclusive.
- [ ] Add the defensive `HEAD`-vs-merge-base check.
- [ ] Tests and docs.

## Acceptance criteria

- [ ] A test in `v2/src/execution/ready-finalize.test.ts` drives `classifyReadyGateFailure` through the real `createDefaultReproduceReadyGateAtBaseRef` (a git fixture repo, or a stubbed runner/v2 spawn) reproducing the run `75ca2a7a` case — a path that passes at a verified `baseRef` tree and fails on the branch — and proves the run settles repairable `ready_gate_failed`, not `ready_gate_out_of_scope`; it fails against the pre-fix probe.
- [ ] The regression test above fails for the same reason identified in the root-cause diagnosis (task checklist's first item), not an unrelated synthetic difference, so fixing that one defect is what makes it pass.
- [ ] A test proves a path that fails with test-failure evidence on both a verified base tree and the branch still settles `ready_gate_out_of_scope`.
- [ ] A test proves `classifyReadyGateFailure` settles repairable `ready_gate_failed`, never `ready_gate_out_of_scope`, when it cannot parse a terminal failed test step or has no `scope`, even when every failing path is outside `allowedPaths`; it fails against the pre-fix code at lines 603–607.
- [ ] A test at the `reproduceReadyGateAtBaseRef` seam proves a probe error settles repairable `ready_gate_failed` with `baseRefProbeError`, not `ready_gate_out_of_scope`.
- [ ] A test drives the real probe (or the v2-mode spawn seam) with a non-zero exit that carries no failing-test evidence for the probed path (e.g. a timeout or a crash) and proves it settles repairable `ready_gate_failed`, not `ready_gate_out_of_scope`; it fails against the pre-fix probe, which treats any non-zero exit as `fail`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` (Ready finalization): which tree and command the base-ref probe runs, and what counts as a conclusive reproduction (verified base tree plus failing-test evidence for the probed path).
- `v2/docs/operator-runbook.md` (Gate trust): `ready_gate_out_of_scope` has been observed wrong in both directions; check the named paths on base and on the branch before believing or dismissing it. Record the diagnosed root cause and the three incident runs here.
- `v2/docs/v1-behaviors.md`: record the conclusive-reproduction rule for out-of-scope classification.

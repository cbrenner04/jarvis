# triage --mark-ready re-runs the gate and promotes on green

## Problem

Exit `10` (`ready-stuck-red`) strands correct work as a draft PR when the
completion ready gate flakes red. Recovery is fully manual: the operator re-runs
the gate in the worktree by hand, then `gh pr ready`. The north-star path
"operator verified green → mark ready" is owned by no command. Fold it into the
existing `triage` command instead of adding a subcommand.

## Decisions

- Recovery is a `--mark-ready` flag on the **named** `triage` form (`jarvis1 triage <worktree-name> --mark-ready`); the no-arg listing and the plain named drill-down stay read-only. — rules out running the gate on every drill-down, putting side effects on a read-only diagnostic.
- Re-run the gate once via the same completion ready path used at run completion (`runReadyGateWithTier`/`maybeMarkReady`) with **no** recorded-green carrier, so it runs the whole `full` gate. — rules out reusing the `readyGateRetryBound` retry loop (out of scope; the operator already verified green).
- On a red gate, exit non-zero, print the captured ready-failure text, leave the PR draft. — rules out marking ready anyway or swallowing the failure text.
- Honor the per-project `readyCommand` override when re-running. — rules out hard-coding `bun run ready` and diverging from the run-completion gate.
- Require an existing draft PR and a complete spec (linked subspecs all checked); otherwise report and do not call `gh pr ready`. — rules out promoting a PR with incomplete work or when no PR exists.

## Task checklist

- Parse `--mark-ready` for the named `triage` form in `v1/src/cli.ts`; dispatch it to the triage command.
- Implement the recovery in `v1/src/commands/triage.ts`: resolve the worktree's branch, spec path (`.active-spec-path`), and PR; re-run the gate once against the worktree; on green mark the PR ready; on red report and leave draft.
- Thread the per-project `readyCommand` to the gate re-run.
- Tests for green→ready, red→draft+non-zero, no-PR/incomplete/already-ready no-op, and read-only forms unchanged.
- Docs (see below).

## Acceptance criteria

- [ ] `jarvis1 triage <worktree-name> --mark-ready` re-runs the completion ready gate once against that worktree and, on green, flips its draft PR to ready and exits 0.
- [ ] On a red gate, `--mark-ready` leaves the PR draft, prints the captured ready-failure text, and exits non-zero.
- [ ] `--mark-ready` uses a per-project `readyCommand` override (when configured) instead of `bun run ready`.
- [ ] `--mark-ready` reports and does not call `gh pr ready` when the worktree has no PR, the PR is already ready, or the spec's linked subspecs are incomplete.
- [ ] `v1/test/triage-command.test.ts` existing listing and drill-down tests stay green — the no-arg listing and the plain named drill-down run no gate and mutate no PR.
- [ ] `jarvis1 triage --help` / the triage usage string lists the `--mark-ready` flag.

## Documentation updates

- [ ] `v1/docs/run-loop.md`: the exit-10 (`ready-stuck-red`) section names `jarvis1 triage <worktree-name> --mark-ready` as the recovery that re-runs the gate and promotes on green.
- [ ] `v1/docs/operator-runbook.md`: the stuck-red (exit 10) recovery step names the `triage --mark-ready` path alongside the existing rerun-`jarvis1 run` path.
- [ ] `v2/docs/v1-behaviors.md`: record the `triage --mark-ready` behavior (gate re-run, green→ready, red→draft+non-zero, no-op guards, `readyCommand` honored) and that the read-only triage forms are unchanged.

---
name: run-settlement-signals-recorded-agent-groups
---

# Run settlement still reaches recorded agent process groups

## Problem

If invoke settle clears run-row pgids before groups die, or terminal settlement races ahead of kill, `jarvis run kill` and daemon `signalRecordedVerifierProcessGroups` / `observeProcessGroupSurvivors` cannot reach escaped agent or tool-shell groups — the operator must SIGKILL by hand.

## Behavior

After upstream kill and deferred-recorder fixes, confirm whether run/workflow settlement already signals every still-recorded pgid for the run; add a trigger at settlement only if gap analysis shows ids would otherwise be cleared or ignored while groups remain alive. Reuse `signalRecordedVerifierProcessGroups` and `observeProcessGroupSurvivors` — no new sweep or reaper.

## Documentation updates

- `docs/operator-runbook.md` — drop manual-kill guidance made obsolete by the no-survivors invariant; note how to spot a leaked agent subtree if the invariant is violated (pgrep/ps by parentage, recorded pgids on the run row).

## Primary implementation surface

- `src/daemon/daemon-run-lifecycle-handlers.ts`

## Prerequisites

- Harness-ended agent invocation leaves no live process in the snapshotted subtree past kill grace, and invoke settle clears each run-row pgid only after that pgid's group is confirmed gone. (delivered by: agent-subtree-no-survivors-after-kill)
- Terminal implement iteration settlement waits for the agent subtree kill to finish before committing loop/run terminal state. (delivered by: implement-iteration-terminal-awaits-agent-kill)
- Daemon startup orphan sweep and live `run kill` already SIGTERM→SIGKILL every `store.verifierProcessGroups` id for the run when invoked. (already true: daemon-sweeps-recorded-agent-groups merged)

## Acceptance criteria

- [ ] Gap found (settlement would clear or skip still-recorded pgids while groups live): new or extended test in `daemon-run-lifecycle-handlers.test.ts` or an adjacent daemon settlement test asserts run/workflow settlement signals every still-recorded pgid via `signalRecordedVerifierProcessGroups` before clear; fails against main.
- [ ] No gap found: active subspec records the analysis conclusion and cites tests that pin current behavior (e.g. `daemon-workflow-start.test.ts` `kill signals every recorded verifier process group before the settlement wait begins`); no settlement trigger change required for that outcome.

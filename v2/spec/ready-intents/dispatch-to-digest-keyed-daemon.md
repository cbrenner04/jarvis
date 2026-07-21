---
name: dispatch-to-digest-keyed-daemon
---

# Dispatch to a digest-keyed daemon

## Problem

- One fixed socket lets a floating CLI contact incompatible daemon code.
- Revision guards then block dispatch or bounce the only daemon while unrelated runs exist.

## Outcome

- Each CLI resolves `daemon-<executable-digest>.sock` before IPC and starts or reuses only that daemon.
- Dispatch continues after executable changes while another daemon owns live runs.
- `run list` and `run wait` remain scoped to the selected daemon.

## Decisions

- Use `shared/executable-tree.ts`'s digest as the socket key; rules out a second version or revision identity.
- Select the keyed socket before connecting; rules out negotiating compatibility through a status reply.
- Start or reuse the matching daemon during dispatch; rules out requiring an operator lifecycle command.
- Remove revision-mismatch refusal, auto-bounce, and `--no-auto-bounce` dispatch behavior; rules out retaining dead compatibility machinery beside keyed routing.
- Keep `run list` and `run wait` single-daemon surfaces; rules out cross-daemon aggregation outside the TUI.
- Automatically cut over from `daemon.sock` by leaving it untouched and selecting only the keyed socket; rules out probing, bouncing, or replacing a legacy daemon.

## Acceptance criteria

- [ ] A CLI contacts only the socket keyed by its executable-tree digest.
- [ ] Dispatch starts or reuses that daemon and proceeds while another digest's daemon has live runs.
- [ ] A non-matching daemon receives no probe, status, list, stop, or dispatch request.
- [ ] Upgrade automatically selects the keyed socket without contacting or replacing an existing unkeyed `daemon.sock`.
- [ ] `run list` and `run wait` operate against the daemon selected for the invoking executable.
- [ ] Revision-mismatch refusal, auto-bounce, and its CLI flag are unreachable from dispatch.
- [ ] A regression test in `v2/src/commands/daemon.test.ts` proves digest-keyed dispatch bypasses a live differently keyed daemon; it fails on baseline.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — keyed socket selection and no compatibility handshake.
- `v2/docs/write-behavior.md` — lifecycle, dispatch, list, and wait semantics.
- `v2/docs/operator-runbook.md` — remove bounce-after-merge operation and recovery.
- `v2/docs/first-workflow-walkthrough.md` — replace fixed socket examples.
- `v2/docs/v1-behaviors.md` — record keyed routing and retired bounce behavior.

## Prerequisites

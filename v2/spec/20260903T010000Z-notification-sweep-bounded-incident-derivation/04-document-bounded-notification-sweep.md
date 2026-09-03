# Document bounded notification sweep

## Problem

Operator docs and the v1 parity catalog still describe unbounded full-store incident derivation and do not warn about notification-sweep event-loop starvation shapes.

## Decision ledger

- `daemon-host.md` § Operator notifications owns bounded candidate filtering, delivery-ledger derivation skip, and no-overlap sweep semantics; rules out duplicating those contracts in `operator-runbook.md` or `state-store.md`.
- `operator-runbook.md` § Daemon lifecycle owns starvation diagnosis distinct from superseded-daemon and `daemon stop`/`run kill` deadlock shapes; rules out folding starvation guidance into § Operator notifications.
- `v1-behaviors.md` records bounded actionable-set derivation as v2 additive parity text; rules out silent behavior drift.

## Prerequisites

- Subspecs 00–03 landed.

## Task checklist

- Update `v2/docs/daemon-host.md` § Operator notifications: bounded candidate set (`ATTENTION_TERMINAL_RECENCY_MS` / `sinceMs`), delivery-ledger derivation skip, and no-overlap sweep guarantee.
- Update `v2/docs/operator-runbook.md` § Daemon lifecycle: notification-sweep event-loop starvation can present as a daemon that binds its socket but never answers reads (reads like `stopped`); retrying `daemon start` stacks CPU spinners; distinguishing checks from superseded-daemon and `daemon stop`/`run kill` deadlock shapes.
- Update `v2/docs/v1-behaviors.md`: notification sweep derives incidents from a bounded actionable set only.

## Acceptance criteria

- [ ] `v2/docs/daemon-host.md` § Operator notifications documents bounded candidate filtering, delivery-ledger derivation skip, and the no-overlap sweep guarantee consistent with subspecs 00–03.
- [ ] `v2/docs/operator-runbook.md` § Daemon lifecycle documents notification-sweep event-loop starvation presentation, the `daemon start` retry hazard, and distinguishing checks from superseded-daemon and deadlock shapes consistent with subspec 03.
- [ ] `v2/docs/v1-behaviors.md` records that the notification sweep derives incidents from a bounded actionable set only.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None beyond the acceptance criteria above.

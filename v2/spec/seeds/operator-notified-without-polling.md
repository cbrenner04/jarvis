---
name: operator-notified-without-polling
---

# Operators poll for completion because Jarvis never pushes it

## Problem

Every operator session invents its own way to learn that work finished: `lsof` + clean-tree + local==remote quiescence checks, `until grep` loops over run logs, re-polling `run list` / `pipeline list`. The harness never *pushes* "this needs you", so every session pulls, differently, and wrong in different ways. This was seeded twice (#731, #1452) and dropped in the 2026-07-18 backlog purge (#1762) as sub-critical; its stated precondition — trustworthy terminal events — had already shipped days earlier (`red-gate-feeds-back-to-the-agent`, `ready-flip-failure-terminal-settles`).

The 2026-07 design ("subscribe to the per-run log stream, daemon holds the sink") is now wrong on two counts:

- **Altitude.** Operator-meaningful state is derived, never emitted: workflow status is a rollup over step run rows at `list` time; pipeline state is `derivePipelineState` over stage rows; there is no pipeline-level event log. Notifying on raw run terminals would ping a dozen times per `full-review` pipeline and never once say "gate reached, decide".
- **Daemon churn.** Daemons are digest-keyed and coexist during supersession; runs can be owned by non-daemon processes; the transitions an operator most needs to hear about (orphan settled at boot, pipeline continued or wedged after restart) happen in the cracks between incarnations. A live subscription or in-memory sink dies with its daemon.

## Decisions

- **Notify at derived operator altitude, on operator-actionable transitions.** Incident vocabulary: pipeline awaiting-approval, pipeline terminal (succeeded / failed / rejected / interrupted, with cause), stage failed, ad-hoc workflow terminal, blocked run, terminal-publication failure — plus the waiting-on-operator states the TUI attention section misses: `budget-soft-stopped`, interrupted-but-not-continued pipelines, wedged `settlement_deferred` stages whose entry run is dead. Rules out raw per-run terminal events and rules out reusing `buildAttentionRows`' projection as-is.
- **One incident, one notification.** Incident identity is highest-altitude-wins: a stage failure subsumes its constituent run failures (the attention section's pinned stage+entry-run double-reporting is the anti-goal). Dedupe key is `(incident id, transition)` so a pipeline that reaches a gate and later fails notifies twice, once each. Rules out N rows per incident.
- **Delivery ledger + sweep, no new write paths.** A small ledger table records what has been delivered; a sweep recomputes derived state from durable rows and diffs against the ledger to find owed notifications. Existing writers (`updateStage`, `commitApprovalDecision`, `commitTerminalRunSettlement`, publication commits) are untouched. Rules out transactional outbox writes at every state funnel and rules out any in-memory subscription.
- **The sweep runs in any live daemon** — after its own state transitions, on a modest timer, and once at boot after reconciliation (so restart-settled incidents are delivered, not lost). Multi-daemon discharge is decided by a conditional insert on the ledger — first writer delivers, losers observe the row and skip. Rules out claims machinery and rules out exactly-once pretensions: delivery is at-least-once, deduped by the ledger key.
- **Discharge on success.** The ledger row commits only after the sink invocation is spawned successfully; a failed spawn leaves the incident owed and the next sweep retries. Rules out silent loss on a transiently broken sink.
- **Sink is a config-registered shell command**, spawned fire-and-forget by the daemon with the incident as JSON (stdin), so it survives closed terminals and covers both the human case (`terminal-notifier`, Slack POST) and the agent-operator case (re-invoke a session) with one mechanism. Absent config, the sweep still maintains the ledger; nothing fires. Rules out an HTTP/SSE/websocket server and rules out webhook plumbing in this slice.
- **The sweep is the shared derivation seam.** Daemon `list` rollup, `derivePipelineState`, and the TUI join each derive operator-facing state independently; the sweep's incident derivation should be written as a reusable module those consumers can migrate to later — named pressure, not scope. Rules out a fourth divergent derivation path.

## Out of scope

- Removing the TUI Needs-attention section — separate seed, sequenced after this lands.
- Webhook/HTTP sinks, OS-notification integrations beyond what the command sink can shell out to.
- Live progress streaming (this is boundaries, not a TUI).
- Changing `run workflow` foreground/`--detach` defaults.
- Any v1 implementation.

## Acceptance criteria

- [ ] A backgrounded pipeline that reaches an approval gate, and later a terminal state, fires the configured sink exactly once per transition with incident JSON naming the pipeline, transition, and cause — pinned by a daemon-level test with a fake sink.
- [ ] A single failed stage produces one incident (not stage + entry-run + step-run rows) — pinned by a test seeding all three durable rows.
- [ ] An incident settled by restart reconciliation while no daemon was alive is delivered by the boot sweep — pinned by a test that settles rows store-side and boots a daemon.
- [ ] Two concurrent sweeps deliver an owed incident once — pinned by a test racing conditional ledger inserts.
- [ ] A sink spawn failure leaves the incident owed; the next sweep retries — pinned by a test.
- [ ] No sink configured: ledger advances, nothing spawns, no errors — pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — replace the background-run-and-poll and quiescence-check guidance with the notification path; polling remains only as fallback diagnosis.
- `v2/docs/daemon-host.md` — sweep placement in the startup order, ledger discharge semantics, multi-daemon behavior.
- `v2/docs/state-store.md` — ledger table and migration.
- `v2/docs/install-and-config.md` — sink command configuration.

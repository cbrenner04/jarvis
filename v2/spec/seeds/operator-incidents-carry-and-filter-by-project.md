---
name: operator-incidents-carry-and-filter-by-project
---

# Operator incidents omit the project, so a multi-project operator cannot tell whose incident fired

## Problem

The daemon is shared across every registered project, but an operator incident carries no project identity. `serializeOperatorIncident` (`v2/src/daemon/operator-incidents.ts`) emits exactly:

```json
{ "incidentId", "kind", "transition", "pipelineId", "stageId", "branchKey", "runId", "cause", "sinceMs" }
```

`operator-incidents.ts` contains no reference to `project` anywhere, even though every `Run` row and every `Pipeline` the derivation already loads carries one. So a sink receives an undifferentiated stream from all registered projects, and the only way to answer "is this mine?" is to take the `runId` and issue a separate `jarvis run list` lookup per incident.

There is no filter either: `notificationSinkCommand` is a single machine-wide command, and the proposed `jarvis notifications wait` surface ([[notifications-wait-is-the-operator-wake-primitive]]) specifies `--kind` filtering but nothing for project.

This is the notification-layer instance of the same gap [[per-project-agent-fallback-order]] describes for agent order: the config and runtime are machine-global where the operator's attention is per-project.

## Evidence

Observed across a single operator session (2026-09-02/03) with three projects live on one daemon — `jarvis`, `homestead-client`/`homestead-service`, `chess-mvp-yolo-2`, the last two driven by a **concurrent second operator session**:

- Roughly **eight incidents** required a manual `jarvis run list … | grep <runId>` purely to establish ownership before they could be ignored. Every one turned out to belong to another project.
- Incident kinds are indistinguishable across projects: `stage-settlement-wedged` for chess and for jarvis are the same shape, and a `run-blocked` from `chess-mvp-yolo-2` reads exactly like one from `jarvis`.
- The cost is not only lookups. An operator scanning a mixed stream is being trained to skim incidents, which is precisely the wrong reflex for a channel whose purpose is to stop work stalling unattended.

Multiple operators have raised this independently.

## Decisions

- **Every incident carries `project`.** Derive it from the row the incident is already built from — `Run.project` for run incidents, the pipeline's owning project for pipeline and stage incidents. Rules out a second lookup by the consumer to recover something the deriving code already held.
- Where an incident genuinely spans no single project, emit `null` rather than omitting the key, so consumers can branch on it without shape-sniffing.
- **Filtering is available at the consumer, not only in the payload:** `--project <name>` on the `notifications wait` / `list` surface, composable with the `--kind` filter that seed already specifies. Rules out every operator re-implementing `jq` selection over a shared file.
- Consider a per-project `notificationSinkCommand` override under `projects.<key>`, alongside the existing per-project `fixCommand` / `readyCommand` / `pipeline` readers, so two concurrent operators can route their own incidents to their own sinks. Sequence after the payload and filter work; the machine-global sink stays the default.
- Do **not** silently scope the default sink to one project — an operator running a single sink today must keep seeing everything unless they opt into a filter.

## Acceptance criteria

- [ ] `serializeOperatorIncident` emits a `project` field for run-derived incidents matching the run's `project` — pinned by a test that fails against the current payload.
- [ ] Pipeline- and stage-derived incidents emit the owning project, and an incident with no single owning project emits `project: null` — pinned by a test.
- [ ] Deriving `project` adds no per-incident store lookup: incident derivation issues the same number of store calls as before for an identical actionable set — pinned by a call-counting test.
- [ ] A consumer filtered to `--project <name>` is not woken by an incident from another project, and is woken by one from its own — pinned by tests covering both directions.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: the incident payload's `project` field and its null case.
- `v2/docs/operator-runbook.md` — § Operator notifications: filtering a shared daemon's incident stream to your own project.

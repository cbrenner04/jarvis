---
name: rename-pipeline-lane-rpc
---

# Rename Pipeline Lane RPC

## Prerequisites

- State-store lane identity is `laneKey` backed by `lane_key`; legacy `branch_key` stores migrate without row, value, or order changes.
- Pipeline execution uses lane terminology, preserves lane values, requires `laneKey` for multi-lane approvals, and names valid lanes for a mismatched target.

## Surface

Daemon.

## Problem

- Daemon pipeline RPC requests and observation payloads expose `branchKey`, inviting clients to supply a git branch.

## Behavior

- `pipeline_list` and `pipeline_wait` emit `laneKey` with no `branchKey`; `pipeline_approve` and `pipeline_reject` accept `laneKey`, temporarily accept deprecated `branchKey` only when `laneKey` is absent, and expose `lane_key_required` for omitted multi-lane targeting.

## Decisions

- Give `laneKey` precedence when both request fields are present; rules out a deprecated alias overriding the current contract.
- Retain the RPC-only `branchKey` alias for one release and document it in one line; rules out either silently breaking an in-flight external client or prolonging the compatibility surface.
- Emit no `branchKey` compatibility field in observation payloads; rules out dual-key responses with ambiguous client precedence.

## Required verification

- Daemon-host tests pin `laneKey`-only list/wait payloads, current approve/reject parameters, alias fallback only when `laneKey` is absent, and `lane_key_required` refusal.

## Documentation updates

- `v2/docs/daemon-host.md` — canonical lane-keyed RPC contracts and one-line deprecated request-alias note.
- `v2/docs/v1-behaviors.md` — RPC rename, alias window, and lane-keyed observation payloads.

# Shared CLI agent spawn helper

repo: /Users/christopherbrenner/Work/jarvis

The `src/agents/*.ts` modules duplicate the same `spawn` → buffer streams →
single-settle → map exit/`stderr` to `AgentResult` pipeline. Extract that into
a small shared helper so future changes to the run loop happen in one place.

- [x] [00 — Shared spawn helper and agent migration](./00-shared-spawn-helper.md)

## Conventions

- Run with `jarvis run spec/2026-05-11-shared-agent-spawn/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If blocked, append `## Blocker` to the subspec and stop.

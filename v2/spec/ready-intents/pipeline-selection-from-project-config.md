---
name: pipeline-selection-from-project-config
---

# Project config selects a pipeline, validated before admission

Slice 1b of [per-project pipelines](../per-project-pipelines-brief.md).

## Prerequisites

- A source-owned registry of named pipeline definitions exists with lookup by name
- Pipeline definition validation exists and returns a named error citing stage and field
- `~/.jarvis/config.json` carries a `projects` registry keyed by project

## Problem

A definition nobody can select is inert. Config must name the pipeline a project runs —
and only that, so config stays data — with resolution failing loudly before any run row,
worktree, or agent invocation exists.

## Decisions

- Project config supplies a pipeline name plus review posture overrides only; stage prompts or executable stage code are a validation rejection, not ignored keys. Rules out config becoming a program.
- Unknown pipeline name is a named operator error at resolution. Rules out a silent default pipeline.
- Resolution validates the composed definition before admission. Rules out materializing state for a definition that cannot run.

## Acceptance criteria

- [ ] Resolving a project yields its named source-owned pipeline; an unknown name is a named error, not a crash or silent default.
- [ ] Config carrying stage prompts or executable code is rejected with a message naming the offending key.
- [ ] Config-supplied review posture composes onto the definition and is validated with the same rules as a source definition.
- [ ] A test asserts an invalid definition produces no run row, no worktree, and no agent invocation.

## Documentation updates

- `v2/docs/install-and-config.md` — pipeline selection keys, posture overrides, and an example.

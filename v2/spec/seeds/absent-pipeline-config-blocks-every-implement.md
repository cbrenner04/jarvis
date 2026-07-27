---
name: absent-pipeline-config-blocks-every-implement
---

# An absent `pipeline` key refuses every implement dispatch

## Problem

Slice 1b (#2248) wired project-pipeline resolution into `buildImplementWorkflowSteps`, and its
resolver treats a **missing** `projects.<key>.pipeline` as `invalid-project-pipeline-config`. Since
`admitProjectPipeline` runs on every implement build, a project that has never opted into pipelines —
which is every project today — can no longer dispatch an implement workflow at all:

```text
$ jarvis run workflow implement --base main --spec v2/spec/<spec>/index.md
invalid-project-pipeline-config: projects.jarvis.pipeline must be an object
```

Observed 2026-07-27 immediately after #2248 merged: both queued implement dispatches refused, and the
lane was dead until `"pipeline": { "name": "fast" }` was hand-added to `~/.jarvis/config.json`.
Nothing consumes the resolved definition yet, so the refusal buys nothing and costs the primary
command.

The plan decided "missing `pipeline` … returns `invalid-project-pipeline-config`", which is right for
a *malformed* fragment and wrong for an absent one. Opting in is a choice; not opting in is the
default.

## Decisions

- An absent `pipeline` key resolves to "no pipeline selected" and implement admission proceeds
  unchanged. Rules out treating absence as malformation.
- A **present but malformed** `pipeline` still fails with the existing path-specific error. Rules out
  relaxing validation for configs that did opt in.
- The distinction is absence vs. presence of the key, not emptiness of the object: `pipeline: {}` is
  present and malformed (no `name`). Rules out a truthiness check.
- Whatever a pipeline-selecting project resolves to stays unconsumed until the execution slice lands;
  this seed changes admission only. Rules out folding execution wiring into the fix.

## Acceptance criteria

- [ ] `jarvis run workflow implement` on a project config with no `pipeline` key admits and dispatches
      exactly as before #2248; a test drives the build with a pipeline-free registry entry and fails
      against the current refusal.
- [ ] A project with a valid `pipeline` still resolves its definition onto the built result.
- [ ] A project with a present but malformed `pipeline` (`{}`, non-object, bad `name`, bad
      `reviewOverrides`) still refuses with its existing path-specific error — one test per shape.
- [ ] Inverting the absence check turns the first test RED.

## Documentation updates

- `v2/docs/install-and-config.md` — `pipeline` is optional; absence means no pipeline selected.

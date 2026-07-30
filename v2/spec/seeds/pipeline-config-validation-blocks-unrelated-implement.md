---
name: pipeline-config-validation-blocks-unrelated-implement
---

# A pipeline-config gap refuses `implement`, which never uses pipelines

## Problem

`jarvis run workflow implement` exits before admission with
`invalid-project-pipeline-config: projects.jarvis.pipeline.terminalAction is required` whenever the
registered project carries a `pipeline` block that fails current validation — even though implement
does not read, resolve, or execute a pipeline.

Observed 2026-07-30: `#2336` made `terminalAction` a required key. The operator's existing
`~/.jarvis/config.json` held `"pipeline": { "name": "full-review" }`, valid until that merge. The
next implement dispatch (slice-5 `execute-pipeline-terminal-publication`) was refused outright. No
run row, worktree, or agent invocation. Recovery was hand-editing the config to add
`"terminalAction": "leave-draft"`.

The runbook already documents `implement` as treating `pipeline` as optional
(`v2/docs/operator-runbook.md` § Pipeline start). Absent is optional; present-and-stale is fatal.
Every future required pipeline key repeats this: a pipeline-phase change silently breaks the
primary implementation path on the next dispatch.

## Decisions

- `implement` does not validate `projects.<name>.pipeline` at all — its preflight resolves only the
  config it consumes; rules out coupling the primary path to pipeline-phase schema churn.
- `pipeline start` keeps full pre-admission validation of the same block unchanged; rules out
  weakening the surface that actually executes pipelines.
- Config load itself does not reject an unparseable `pipeline` block for non-pipeline commands;
  the refusal belongs to the command that reads it — rules out moving the same hard failure one
  layer down into `loadMachineConfig`.
- Deferred: whether `config show` should warn about a stale `pipeline` block. Not required to
  unblock implement.

## Acceptance criteria

- [ ] `jarvis run workflow implement` admits normally against a registered project whose
      `pipeline` block is missing `terminalAction`, and against one whose `pipeline` block is
      structurally invalid; both dispatch a run.
- [ ] `jarvis pipeline start` against the same missing-`terminalAction` config still refuses
      pre-admission with the existing `invalid-project-pipeline-config` message naming
      `projects.<name>.pipeline.terminalAction`.
- [ ] Inverting the guard that scopes pipeline validation to pipeline commands makes the implement
      admission test fail.
- [ ] `v2/docs/operator-runbook.md` states that implement ignores `projects.<name>.pipeline`
      entirely, replacing the weaker "treats `pipeline` as optional" wording.

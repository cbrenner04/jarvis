---
name: expose-branch-scoped-pipeline-resume-cli
---

# Expose Branch-Scoped Pipeline Resume in the CLI

## Prerequisites

- The state store atomically reopens a valid failed continuation and skipped suffix for one named fan-out branch while leaving sibling rows untouched, and omission of branch scope retains whole-pipeline reopen behavior.
- Resume orchestration evaluates, reopens, and continues one named failed branch despite sibling awaiting gates, refuses a gate on the named branch with branch-and-gate detail, and preserves unscoped resume semantics.
- The daemon `pipeline_resume` RPC accepts optional non-empty `branchKey`, forwards it to branch-local resume orchestration, and preserves the existing response envelope and unscoped request contract.

## Primary implementation surface

`v2/src/commands/pipeline.ts`

## Problem

`jarvis pipeline resume` rejects a branch-key positional and can issue only whole-pipeline resume requests.

## Behavior

`jarvis pipeline resume <pipeline-id> [<branch-key>]` sends optional branch scope, exits silently on admitted replay, and prints branch-specific refusals on stderr with a non-zero exit.

## Decisions

- Branch scope is the optional second positional argument; rules out a flag or a separate subcommand.
- The CLI includes `branchKey` only when supplied and sends the existing `{ pipelineId }` request otherwise; rules out changing whole-pipeline wire requests.
- Refusal text remains the daemon reason verbatim and success remains silent exit zero; rules out CLI-authored reinterpretation or success output.

## Acceptance criteria

- [ ] `pipeline.test.ts` fails against the baseline, then proves the optional branch positional is accepted, forwarded as `branchKey`, and reflected in command help and usage.
- [ ] `pipeline.test.ts` proves branch-specific refusal detail is written to stderr with exit one and malformed arity contacts no daemon.
- [ ] Existing `jarvis pipeline resume <pipeline-id>` tests stay green and continue sending only `{ pipelineId }`.

## Documentation updates

- `v2/docs/operator-runbook.md` — branch-scoped command form, use after an approved branch fails, sibling-gate isolation, own-gate refusal, and approve/reject guidance.
- `v2/docs/v1-behaviors.md` — v2 CLI branch-scoped resume form and unchanged unscoped form.

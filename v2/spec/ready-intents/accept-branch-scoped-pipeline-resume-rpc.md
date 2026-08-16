---
name: accept-branch-scoped-pipeline-resume-rpc
---

# Accept Branch-Scoped Pipeline Resume RPCs

## Prerequisites

- The state store atomically reopens a valid failed continuation and skipped suffix for one named fan-out branch while leaving sibling rows untouched, and omission of branch scope retains whole-pipeline reopen behavior.
- Resume orchestration evaluates, reopens, and continues one named failed branch despite sibling awaiting gates, refuses a gate on the named branch with branch-and-gate detail, and preserves unscoped resume semantics.

## Primary implementation surface

`v2/src/daemon/daemon.ts`

## Problem

The `pipeline_resume` handler accepts only a pipeline ID and cannot expose branch-local resume orchestration over IPC.

## Behavior

`pipeline_resume` accepts an optional non-empty `branchKey`, forwards it to resume orchestration, and returns its branch-specific admission or refusal without changing the unscoped request contract.

## Decisions

- `branchKey` is optional in the existing `pipeline_resume` params object; rules out a second RPC method or breaking unscoped callers.
- A supplied empty or non-string branch key is `invalid_params`; rules out collapsing malformed branch scope into unscoped resume.
- Applied and refused responses keep the existing envelope and refusal-reason field; rules out a parallel branch-only response shape.

## Acceptance criteria

- [ ] `daemon-pipeline-resume.test.ts` fails against the baseline, then proves a `22041e31`-shaped request replays the approved branch's failed plan while two sibling gates stay awaiting and receive no dispatch or mutation.
- [ ] `daemon-pipeline-resume.test.ts` proves a request targeting its own awaiting gate refuses with the branch key and gate named and issues no dispatch.
- [ ] Existing unscoped `pipeline_resume` handler tests stay green.

## Documentation updates

- `v2/docs/daemon-host.md` — optional `pipeline_resume.branchKey`, validation, response shape, and per-branch dispatch scope.
- `v2/docs/v1-behaviors.md` — v2 daemon RPC support for branch-scoped pipeline resume.

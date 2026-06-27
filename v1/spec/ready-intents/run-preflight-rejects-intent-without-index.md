---
name: run-preflight-rejects-intent-without-index
---

# jarvis run fails fast when a spec dir has intent.md but no index.md

When `jarvis run` is pointed at a spec directory holding `intent.md` but no
`index.md` (the output of a blocked plan), it fails late and opaquely
(`spec path does not exist`) after launching. The operator gets no early
guidance that the spec is an incomplete blocked-plan artifact.

`jarvis run` should preflight this case and fail fast — before invoking an
agent — with a clear, named error explaining the spec dir has an `intent.md` but
no `index.md` (likely a blocked plan) and what to do (resume/re-plan).

## Documentation updates

- `v1/docs/run-loop.md` — document the new preflight check and its guidance.

## Prerequisites

- jarvis run runs named preflight checks against the resolved spec path before invoking an agent

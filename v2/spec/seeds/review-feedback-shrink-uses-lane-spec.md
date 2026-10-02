---
name: review-feedback-shrink-uses-lane-spec
---

# Review-feedback shrink reads the lane's spec, not the response sidecar

## Problem

A `review-feedback` round's write step and its `review-feedback~shrink` step carry `spec = .jarvis-review-feedback-response.md` (the never-committed response sidecar). The shrink prompt's "Completed Spec (read-only)" block then inlines what appears to be the whole repository (231 095 echoed stderr lines for one invocation); cursor exits `-1` in ~8–11 s echoing the prompt, the row settles `invocation_failure`, and publication never runs — the write step's fix commit stays local and unpushed. The write commit's `Spec:` trailer also names the sidecar.

## Evidence

- 2026-10-02, three of three review-feedback rounds: `7fa3a6b0` (#4459, 11 s), `579af7ec` (#4467, 8 s, session log 231 095 stderr lines). On #4467 the write step's correct fix (`305b6a9ea`) was committed locally only; operator force-killed the shrink and hand-pushed.

## Decisions

- Review-feedback steps resolve their spec from the lane's entry run (`entrySpecPath` already on the resolved lane target), never the response sidecar.
- Shrink spec rendering is bounded: a spec path that is not a readable spec file/tree fails fast with a named contract error instead of inlining arbitrary content.

## Acceptance criteria

- [ ] A review-feedback workflow test asserts the write and `~shrink` steps carry the lane's entry spec path (not `.jarvis-review-feedback-response.md`); fails against current code.
- [ ] Shrink prompt building with a non-spec path settles a named failure without inlining repository content; fails against current code.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Review-feedback workflow.

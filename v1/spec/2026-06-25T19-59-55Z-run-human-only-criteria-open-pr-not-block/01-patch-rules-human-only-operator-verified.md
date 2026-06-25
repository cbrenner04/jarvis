# Patch rules: treat human-only criteria as operator-verified

## Problem

On a CSS/layout subspec the agent implemented the fix, passed the automated gate,
then tried to launch a dev server to visually confirm a human-only criterion, hit
a sandbox bind error (`listen EPERM … ::1:3000`), and appended a `## Blocker` —
exiting 7. The agent has no guidance that human-only criteria are the operator's
to verify, not the sandbox's.

## Decisions

- Recognize the same three seed markers as the harness: `(Manual)`, `visual inspection only`, `no automated guard`. Rules out divergent agent/harness definitions.
- Guidance: implement, run the automated gate, leave human-only criteria unchecked, do **not** attempt in-sandbox visual verification (no dev-server/port bind), and do **not** append a `## Blocker` for them. Rules out the dev-server-bind blocker that suppressed the PR.
- This prompt rule is an assist that reduces blocker churn, not the defense: subspec 00's harness blocker guard is what guarantees a human-only-only run still produces the PR even if the agent blocks anyway. Rules out treating the prompt as the sole fix.
- Bump `patch.rules` `revision`. Rules out a stale-revision snapshot drift.

## Task checklist

- [ ] Add a short rule to `prompts/patch/rules.md` covering human-only criteria; bump `revision`.
- [ ] Update the prompt snapshot/render tests to include the new guidance.
- [ ] Update docs.

## Acceptance criteria

- [x] The rendered patch implementation prompt instructs agents that acceptance criteria flagged human-only (`(Manual)`, "visual inspection only", "no automated guard") are operator-verified: implement and leave them unchecked, do not attempt in-sandbox visual verification or bind a dev-server port for them, and do not append a `## Blocker` for them.
- [x] `prompts/patch/rules.md` `revision` is incremented and the prompt registry/snapshot tests pass with the new fragment.

## Documentation updates

- `v1/docs/run-loop.md` (or `v1/docs/spec-guidance.md`) — note that agents leave human-only criteria for human verification rather than blocking.
- `v2/docs/v1-behaviors.md` — update the patch-rules revision entry to record the new guidance.

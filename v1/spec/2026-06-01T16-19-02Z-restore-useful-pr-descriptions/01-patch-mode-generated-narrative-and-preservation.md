# 01 - Patch-mode generated narrative and preservation

## Problem

- Patch-mode PR rewrites preserve the whole `jarvis:narrative` payload, which would freeze stale machine text if generation moves inside the markers.
- The near-empty-body regression must be fixed without discarding human edits inside the markers.

## Decisions

- Replace the current patch narrative payload with model-authored `Description` + `Decisions:` produced from the shared fragment; do not keep the old deterministic checklist/progress narrative.
- Track the machine-owned payload inside the existing `jarvis:narrative` block with harness-owned inner markers or equivalent structured metadata; do not rely on whole-block preservation once generated text lives inside the preserved region.
- Treat narrative content that differs from the machine-owned payload shape as human-owned and preserve it verbatim on rewrites; do not attempt partial human/machine merges in this slice.
- When no human-owned narrative exists, regenerate the machine-owned `Description` + `Decisions:` block on each patch PR-body rewrite; do not keep the previous generated block indefinitely.
- Keep attribution footer assembly unchanged and appended after the rebuilt body; do not move footer text into the prompt or the preserved narrative block.

## Tasks

- [ ] Add the patch-mode PR-description generation path that calls the shared fragment and validates the returned `Description` + `Decisions:` shape.
- [ ] Update patch PR-body assembly and rewrite logic so the generated block lives inside `jarvis:narrative` and can be distinguished from human edits on later rewrites.
- [ ] Preserve verbatim human-written narrative inside `jarvis:narrative` when present.
- [ ] Regenerate the generated block when the narrative is empty or still machine-owned.
- [ ] Add regression tests for the near-empty-body path, generated-body shape, regeneration without human edits, and preservation with human edits.

## Acceptance criteria

- [ ] Patch-mode draft PR creation produces a body whose narrative section is a model-authored short description followed by `Decisions:` and an unordered list.
- [ ] Patch-mode PR rewrites preserve human-written narrative inside `jarvis:narrative` markers unchanged.
- [ ] Patch-mode PR rewrites regenerate the generated `Description` + `Decisions:` block when no human-owned narrative exists, instead of preserving stale machine text or leaving the body nearly empty.
- [ ] Attribution footer output and placement are unchanged from current shipped behavior.
- [ ] Automated tests cover the prior near-empty regression path and the human-preservation path.

## Documentation updates

- [ ] Update `v1/docs/run-loop.md` to replace the deterministic/near-empty patch PR-body description with the shipped generated `Description` + `Decisions:` behavior.
- [ ] Update `v1/docs/worktrees-and-commits.md` patch PR-body rewrite semantics for generated narrative vs preserved human narrative.

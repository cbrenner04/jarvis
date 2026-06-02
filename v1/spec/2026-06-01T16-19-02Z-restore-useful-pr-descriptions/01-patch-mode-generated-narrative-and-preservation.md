# 01 - Patch-mode generated narrative and preservation

## Problem

- Patch PR rewrites currently preserve `jarvis:narrative` as one block, which would freeze stale generated text once generation moves inside the markers.

## Decisions

- Replace the current patch narrative payload with model-authored `Description` + `Decisions:` produced from the shared fragment; do not keep the old deterministic checklist/progress narrative.
- Make machine-owned narrative distinguishable from human-authored edits inside `jarvis:narrative`; do not preserve stale generated text as if it were human-authored.
- Preserve verbatim human-authored narrative and regenerate only when the block is empty or still machine-owned; do not attempt partial human/machine merges in this slice.
- Keep attribution footer assembly unchanged and appended after the rebuilt body; do not move footer text into the prompt or the preserved narrative block.

## Tasks

- [ ] Add the patch-mode PR-description generation path that calls the shared fragment and validates the returned `Description` + `Decisions:` shape.
- [ ] Update patch PR-body assembly and rewrite logic so generated narrative lives inside `jarvis:narrative`, human narrative is preserved verbatim, and machine-owned narrative is regenerated.
- [ ] Add regression tests for the near-empty-body path, generated-body shape, regeneration without human edits, and preservation with human edits.

## Acceptance criteria

- [ ] Patch-mode draft PR creation produces a body whose narrative section is a model-authored short description followed by `Decisions:` and an unordered list.
- [ ] Patch-mode PR rewrites preserve human-written narrative inside `jarvis:narrative` markers unchanged.
- [ ] Patch-mode PR rewrites regenerate the generated `Description` + `Decisions:` block when no human-authored narrative exists, instead of preserving stale machine text or leaving the body nearly empty.
- [ ] Attribution footer output and placement are unchanged from current shipped behavior.
- [ ] Automated tests cover the prior near-empty regression path and the human-preservation path.

## Documentation updates

- [ ] Update `v1/docs/run-loop.md` to replace the deterministic/near-empty patch PR-body description with the shipped generated `Description` + `Decisions:` behavior.
- [ ] Update `v1/docs/worktrees-and-commits.md` patch PR-body rewrite semantics for generated narrative vs preserved human narrative.
- [ ] Update `v2/docs/v1-behaviors.md` for the shipped patch-mode PR-body behavior.

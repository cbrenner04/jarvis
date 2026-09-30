---
name: republication-redrafts-harness-ready-pr
---

# Completion republication re-drafts harness-ready PRs

## Problem

When a lane re-publishes after the harness already flipped its PR ready, `resolveOpenDraftPr` throws `OpenPrNotDraftError` and forces manual `gh pr ready --undo` even though the harness caused the non-draft state.

## Behavior

Completion publication consults lane ready-flip evidence before refusing a sole open non-draft PR for the branch and base. When lineage evidence matches the publication branch, base ref, and that PR number, publication runs `gh pr ready --undo` once, reuses the PR as an open draft, and continues normally; the terminal step flips ready again after the gate and re-records evidence (newest wins). The lookup keys on the requested base ref, matching recording sites, so retargeted lanes still match. After `--undo` the PR is re-resolved; a PR merged/closed meanwhile fails publication naming it. Pipeline terminal publication treats a sole open non-draft PR with matching evidence as already flipped: it skips `gh pr ready`, re-records evidence, and succeeds; without evidence it still refuses. No matching evidence, a different PR number, or evidence whose branch or base ref differs from the publication target keeps `OpenPrNotDraftError` and the existing message. A failed `--undo` fails publication naming operation `gh pr ready --undo` and the PR number, with no retry loop. Ambiguous-PR and no-commits paths stay unchanged.

## Acceptance criteria

- [ ] `completion-publisher.test.ts` fails against the pre-fix resolver and, with a fake `gh` reporting one open non-draft PR #N for the publication branch and base and matching lane evidence for that triple, asserts `gh pr ready --undo N`, reuse of #N, and no throw.
- [ ] The same fake with no recorded flip evidence throws `OpenPrNotDraftError` and issues no `--undo`.
- [ ] Evidence recording a flip of #M while #N is open throws `OpenPrNotDraftError` and issues no `--undo`.
- [ ] Evidence for #N on a different branch or base ref than the publication target throws `OpenPrNotDraftError` and issues no `--undo`.
- [ ] A retargeted-base lane finds evidence recorded under the requested base ref.
- [ ] Post-undo re-resolution finding #N merged/closed fails naming #N.
- [ ] Terminal publication with evidenced ready #N succeeds without `gh pr ready` and re-records; without evidence it refuses.
- [ ] A failing `--undo` surfaces a publication failure naming `gh pr ready --undo` and #N.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — drop manual `gh pr ready --undo` recovery for harness-flipped PRs on both completion republication and pipeline terminal publication; keep it for human-flipped PRs.
- `v2/docs/write-behavior.md` — re-drafting of self-flipped PRs on republication.
- `v2/docs/v1-behaviors.md` — record the changed republication behavior.

## Prerequisites

- Run rows persist harness ready-flip evidence (PR number, branch, base ref, flip time) through the state store, and lineage lookup returns a prior row's evidence when branch, base ref, and PR number match the same spec/lane.
- Terminal publication records ready-flip evidence only after a successful `gh pr ready` and records none when that flip fails.

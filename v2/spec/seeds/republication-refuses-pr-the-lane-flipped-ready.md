---
name: republication-refuses-pr-the-lane-flipped-ready
---

# Republication refuses the PR its own lane flipped ready

## Problem

Implement completion flips the lane's draft PR ready after a green gate (`v2/src/execution/terminal-publication.ts:207`, `deps.ghReadyFlip` → `gh pr ready`, `:280`). When the lane is re-driven later (`pipeline resume` / `run resume` after a downstream failure, or re-publication after `main` moved), completion publication resolves the open PR via `resolveOpenDraftPr` and refuses any non-draft match (`v2/src/execution/completion-publisher.ts:348` → `OpenPrNotDraftError`, `:285`; terminal path rewraps it at `terminal-publication.ts:175`): `PR #<n> for branch <b> is open but not a draft (expected draft). Mark it draft again, or close/merge it, before publishing.` The harness made that PR ready itself, yet the operator must `gh pr ready --undo <n>` by hand and resume.

Evidence, 3× on 2026-09-30: PR #4216 (lane `run-resume-claims-terminal-from-draining-generation`, row `37c69564`); PR #4191 (lane `non-terminating-mutation-settlement-names-its-site`, rows `8dce9760`, `f0b19f6f`). No operator touched draft state on either before the refusal.

## Decisions

- A successful ready flip records durable evidence on the lane's run row: PR number, branch, base ref, flip time. Recorded only after `gh pr ready` succeeds.
- On re-publication, an open non-draft PR matching branch+base whose number equals recorded ready-flip evidence from this lane (same spec/lane lineage, any prior row) is re-drafted (`gh pr ready --undo`) and reused; publication proceeds as for an open draft, and the terminal step re-flips it ready after the gate as normal.
- No matching evidence (flipped by an operator/anyone else, or number mismatch) → still `OpenPrNotDraftError`, unchanged message.
- Re-draft failure fails publication with operation `gh pr ready --undo` and the PR number; no retry loop.
- Ambiguous-PR and no-commits paths unchanged.

## Acceptance criteria

- [ ] With a fake `gh` reporting one open non-draft PR #N and lane evidence recording a ready flip of #N, publication calls `gh pr ready --undo N`, reuses #N, and does not throw.
- [ ] Same fake with no recorded flip evidence throws `OpenPrNotDraftError` and issues no `--undo`.
- [ ] Evidence recording #M ≠ #N throws `OpenPrNotDraftError`.
- [ ] A successful terminal ready flip persists the evidence; a failed `gh pr ready` persists none.
- [ ] A failing `--undo` surfaces a publication failure naming `gh pr ready --undo` and #N.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md`: drop the manual `gh pr ready --undo` recovery for harness-flipped PRs; keep it for operator-flipped ones.
- `v2/docs/write-behavior.md`: note re-drafting of self-flipped PRs on republication.
- `v2/docs/v1-behaviors.md`: record the changed republication behavior.

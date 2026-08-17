---
name: implement-resumes-stalled-unmerged-subspec-chain
---

# No clean resume for a manual implement whose subspec chain stalled with committed-but-unmerged subspecs

## Problem

A manually-driven `jarvis run workflow implement` auto-chains successor runs across subspecs. When the chain stalls — a subspec run fails/blocks, or the daemon dies mid-chain — the worktree is left with completed subspecs committed on the branch but **unmerged**. There is no clean one-command resume:

- Re-running `--base main` hits the **preserve-landed-criteria** refusal (the worktree has acceptance criteria ticked that are unticked on `main`) — correct protection of the work, but it blocks continuation and only offers `--reset-despite-landed-criteria`, which *discards* the completed subspecs.
- Re-running `--base <the-branch>` is the self-referential destruction trap (see [[implement-retirement-destroys-artifacts-before-materialization]]).

So the operator must merge the partial spec first, or hand-drive the remaining subspecs — neither is a "resume." The completed subspecs are stranded behind a gate meant to protect them.

Observed 2026-08-16: v2-init implement chain (`2c40057f` → `174b84fe` → `0d032965`) completed subspecs 00/01/02 then stalled at 03 (`0d032965` settled `unsupported_resume_context` during a quota break). Re-running `--base main` refused on preserve-landed-criteria; there was no built-in way to continue from subspec 03 without merging 00/01/02 or discarding them.

## Decisions

- Provide a resume path that continues an incomplete implement on its **existing worktree** from the first unticked subspec, preserving already-committed subspecs, without requiring them to be merged into `--base` first. Plan decides the shape: a `--resume`/`--continue` opt-in, or treating "worktree is a clean descendant of `--base` with only *extra* ticked criteria" as resumable (reuse the worktree, skip retirement, route to the next unticked subspec) rather than a hard refusal.
- The preserve-landed-criteria refusal must name the **non-destructive** continue path, not only `--reset-despite-landed-criteria` (discard). Rules out an operator concluding the only options are discard or merge.
- Resume must not re-run or re-commit completed subspecs (routing keys off unticked criteria in the worktree spec tree) and must not require `--base` to already contain the committed work.
- A dirty worktree (uncommitted tracked/untracked beyond harness sidecars) still refuses; a genuinely complete spec still exits `implement.already_complete`. Rules out scope creep into those gates.

## Acceptance criteria

- [ ] An incomplete implement whose worktree has committed-but-unmerged ticked subspecs can be resumed by a single command that continues from the first unticked subspec on the existing worktree, without merging or discarding the completed subspecs, pinned by a test.
- [ ] The resume path reuses the existing worktree commits — it does not retire and rematerialize — pinned by a test.
- [ ] The preserve-landed-criteria refusal message names the non-destructive resume path (not only `--reset-despite-landed-criteria`), pinned by a message/test assertion.
- [ ] A dirty worktree still refuses and a genuinely complete spec still exits `implement.already_complete`, pinned by existing tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — how to resume a stalled manual implement whose chain left committed-unmerged subspecs, and when to use it vs merge.
- `v2/docs/workflow-runner.md` — resume-on-existing-worktree semantics and its relation to the preserve-landed-criteria gate.

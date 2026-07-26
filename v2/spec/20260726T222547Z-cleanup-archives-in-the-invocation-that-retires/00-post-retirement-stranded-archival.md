# Post-retirement stranded archival and dry-run parity

## Problem

`runCleanupCommand` passes the pre-retirement `discovered` worktree snapshot into
`inspectStrandedArtifacts`. Open-home specs whose owning worktree is retired later in the
same invocation fail the materialized-owner gate during that inspect pass, never enter
the stranded archive set, and stay at the spec home until a second cleanup. `--dry-run`
uses the same stale ownership view, so open-home stranded preview stdout can disagree
with what apply archives or refuses for those specs.

## Prerequisites

- `jarvis cleanup` retires eligible merged-PR worktrees and archives completed specs to
  `completed/`.
- Archival eligibility refuses on unchecked criteria, an open matching PR, and a
  materialized owner.

## Decisions

- Re-derive materialized worktrees after worktree retirement and run open-home stranded
  inspect/archive against that post-retirement list in the same apply invocation; the
  post-retirement list reflects **successful** retirements only; rules out reusing the
  pre-retirement `discovered` snapshot for the ownership gate at archive time and rules
  out requiring a second cleanup for specs whose owner was just retired.
- Keep post-retirement worktree archival (`archiveRetiredArtifact`) as-is; this slice fixes
  the open-home stranded path only; rules out folding unrelated retirement-archive logic
  into the same reorder.
- Ownership refusal still applies when a materialized same-project worktree on the
  recorded implementation branch remains after retirement; refusal keeps the existing
  ownership category stdout (`another materialized worktree owns this spec`); rules out
  weakening the gate or expanding refusal copy in this spec (richer owner detail is a
  serial follow-up on the shared cleanup refusal stdout seam).
- Unchecked-criteria and open-matching-PR refusal reasons and wording stay unchanged;
  rules out drive-by eligibility copy edits.
- `--dry-run` open-home stranded ownership uses materialized worktrees minus worktrees
  preview would retire, so stranded archive lines match apply for the same registry state
  for that slice; rules out dry-run continuing to preview stranded ownership from the
  unadjusted pre-retirement list.
- Dry-run vs apply parity acceptance covers **open-home stranded archival** when the
  owning worktree is in the retire-preview (or retired) set only; rules out treating this
  spec as full-command dry-run ≡ apply (worktree retirement preview, sockets,
  post-confirm eligibility recheck, and merged-PR preview/apply races stay unchanged and
  out of scope).
- `--dry-run` must not report nothing to clean when effective stranded inspect (after
  retire-preview adjustment) would archive open-home specs; rules out false "nothing to
  clean" when stranded work remains.
- Out of scope: archival eligibility rules, dead-socket reaping, `archiveRetiredArtifact`
  identity resolution.

## Task checklist

- [ ] After `retireEligibleWorktrees`, re-discover materialized worktrees and inspect
  plus archive open-home stranded artifacts against that list (reuse
  `inspectStrandedArtifacts` / `retireStrandedArtifacts` or equivalent).
- [ ] Stop passing the pre-retirement snapshot into the apply-time stranded ownership
  gate; pre-retirement inspect may remain only for early exit/preview inputs that do not
  claim apply-time archive outcomes.
- [ ] Adjust `--dry-run` stranded preview to use effective materialized worktrees (exclude
  preview-retire candidates) and align `hasNothingToClean` / stranded preview counts with
  that view.
- [ ] Add `cleanup.test.ts` regression fixture: complete spec at the **open** spec home
  (stranded-discoverable); pre-retirement stranded inspect refuses with the ownership
  message while the owner worktree is still materialized; retirement-path archival does
  **not** move that tree; one apply pass retires the owner and archives via
  post-retirement stranded inspect into `completed/`.
- [ ] Add guard-inversion test: materialized owner not retired this invocation → refusal
  with existing ownership message and no archival; inverted guard allows archive.
- [ ] Add or extend test: `--dry-run` stranded archive lines for open-home specs match apply
  archival for the same state when the owning worktree is in the retire preview set.
- [ ] Update docs per documentation updates below.

## Acceptance criteria

- [ ] `cleanup.test.ts` `archives open-home spec when retiring its owning worktree in one invocation` (or equivalent) uses the pinned fixture: open-home complete spec, pre-retirement stranded ownership refusal, no retirement-path move, single apply retires owner and archives via post-retirement stranded path; fails against pre-fix ordering.
- [ ] The new regression test's immediate second `runCleanupCommand` apply reports nothing to clean.
- [ ] Guard inversion: with a materialized owner this invocation does not retire, open-home archival is refused with stdout containing `another materialized worktree owns this spec` and the spec stays at open home; test fails if archival succeeds while the owner remains.
- [ ] `cleanup.test.ts` `archives eligible stranded specs without retiring a worktree and retains refused siblings` stays green.
- [ ] `cleanup.test.ts` dry-run vs apply parity test for open-home stranded archival when owners are in the retire preview set passes; fails when dry-run uses the pre-retirement ownership snapshot.
- [ ] `v2/docs/operator-runbook.md` § Cleanup documents same-invocation open-home archival and bounded `--dry-run` stranded prediction (not full-command equivalence).
- [ ] `v2/docs/write-behavior.md` § Cleanup and `v2/docs/v1-behaviors.md` cleanup stranded entries document post-retirement materialized list for apply stranded ownership and retire-preview-adjusted list for dry-run stranded preview.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup — state the single-invocation guarantee for
  open-home specs whose owner worktree is retired in the same run; replace the incorrect
  blanket `--dry-run` "candidates may all be refused at apply" framing with what dry-run
  can predict for **open-home stranded** archival when retire candidates are known; note
  limits (post-confirm recheck, eligibility races) unchanged.
- `v2/docs/write-behavior.md` § Cleanup — same post-retirement / retire-preview-adjusted
  ownership facts as the runbook for the CLI contract.
- `v2/docs/v1-behaviors.md` — v2 cleanup stranded archival entries: apply stranded
  ownership against post-retirement materialized worktrees; dry-run stranded ownership
  against retire-preview-adjusted materialized worktrees.

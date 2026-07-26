---
name: archival-refusal-names-why-owner-was-not-retired
---

# Archival refusal names why the owning worktree was not retired

When cleanup refuses to archive a spec because a materialized worktree owns it, stdout says only
"another materialized worktree owns this spec". That names the symptom, not the cause, and sent the
operator to the wrong defect while diagnosing the `killed`-row gate. The refusal must carry the
reason that owner failed retirement (PR state, non-terminal run, live daemon run, lock held,
fail-closed error).

## Decisions

- The refusal reports the owner's retirement-refusal reason alongside the ownership fact.
  Rules out leaving the message ownership-only, which misattributes the cause.
- Applies to both refusal sites (post-retirement artifacts and stranded-spec scans) and to
  `--dry-run` previews, so the operator sees the same reason in plan and apply output.

## Acceptance criteria

- [ ] An archival refusal caused by an unretired owner names why that owner was not retired; a test
      asserts the reason text appears in the message.
- [ ] A refusal whose owner is ineligible for a fail-closed reason (`gh` error, daemon unreachable)
      surfaces that reason rather than a generic ownership line.
- [ ] Existing cleanup stdout tests are updated, not weakened: the stranded-artifact assertions in
      `cleanup.test.ts` (lines asserting `"another materialized worktree owns this spec"`, e.g.
      "archives eligible stranded specs without retiring a worktree and retains refused siblings")
      and `cleanup-artifacts.test.ts` ("materialized worktree owns" case) still identify the
      artifact path.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Cleanup: eligibility gate: record that ownership refusals name
  the owner's retirement-refusal reason.
- `v2/docs/v1-behaviors.md` — record that archival refusals now name the owner's specific
  retirement-refusal reason, not just the ownership fact.

## Prerequisites

- Cleanup refuses spec archival when another materialized worktree owns the spec
- Cleanup's eligibility gate returns a reason string for each ineligible worktree
- Terminal durable runs no longer block worktree retirement

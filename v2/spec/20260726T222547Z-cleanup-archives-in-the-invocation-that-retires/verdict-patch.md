Reviewing implementation against the subspec acceptance criteria.


## Verdict — required outcomes

1. **Regression test must pin “no retirement-path move” for the open-home fixture**  
   The subspec acceptance criteria require a complete spec at open home, pre-retirement stranded ownership refusal, and that retirement-path archival does **not** move that tree before post-retirement stranded archival succeeds. The current regression only checks final paths and a pre-apply `inspectStrandedArtifacts` probe; it does not show that apply skipped retirement-path archival for the open-home source (e.g. skip reason such as no durable identity, or no retirement-path `Archived:` for the open-home path while the stranded path archives). **Outcome:** the primary regression test fails if retirement-path archival moves the open-home tree or if archival cannot be attributed to the post-retirement stranded pass.

2. **Restore or correct the retirement-path ordering test**  
   `retires before archiving a complete durable spec…` still reads as “remove worktree before retirement-path archive,” but the assertion only requires `retire` after *some* `inspect archive` event, which pre-confirm stranded inspect can satisfy. **Outcome:** either the test again proves worktree removal precedes retirement-path archival for that fixture, or the test name/description no longer claims ordering that is not checked.

3. **Align `intent.md` with the completed subspec**  
   `intent.md` still has open acceptance criteria, full dry-run ≡ apply wording, “refusal names the materialized owner,” and an unverified “unknowable preview” decision, while the shipped subspec, docs, and index mark the work complete. **Outcome:** `intent.md` matches the subspec on bounded open-home stranded dry-run parity, ownership refusal via the existing category message (not richer owner detail), and dropped/softened unknowable-preview scope; acceptance criteria reflect what was verified, not aspirational full-command parity.

4. **Tighten dry-run parity docs for failed retirements (one bounded hedge)**  
   Apply stranded ownership uses materialized worktrees after **successful** retirements; dry-run excludes all retire-preview paths. If a previewed worktree is not actually removed, dry-run can still show stranded `archive:` while apply still sees an owner. Runbook/write-behavior “match apply when those owners are the only blockers” is slightly stronger than what the code guarantees. **Outcome:** operator-facing cleanup docs state that bounded stranded dry-run ≡ apply for open-home specs assumes retire-preview worktrees are actually removed on apply (same assumption as the post-retirement materialized list), without implying full-command dry-run equivalence.

**Rationale (summary):** Core implementation (post-retirement rediscovery for apply stranded ownership, retire-preview-adjusted list for dry-run preview/`hasNothingToClean` inputs) matches the completed subspec and fixes the stale-`discovered` bug. The gaps above are contract and test precision: the pinned regression AC, a misleading ordering test, stale intent metadata, and a small doc over-promise on dry-run when retirement partially fails. None of these require reworking the main reorder in `runCleanupCommand`.

**Not required for merge (actuator may defer):** stranded-only `hasNothingToClean` dry-run fixture; dedicated `hasStrandedOwner` inversion unit test beyond existing E2E; duplicate stranded inspect stdout on apply; exit code after successful stranded work when worktree retirement failed (pre-existing, out of subspec scope).
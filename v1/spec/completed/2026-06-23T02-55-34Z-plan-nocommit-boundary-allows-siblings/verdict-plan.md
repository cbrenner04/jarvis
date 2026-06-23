The source confirms both critical mechanisms. I'll issue the verdict.

## Verdict

The core design — separating legitimate siblings from escapes by a pre-write directory snapshot rather than a name allowlist — is sound and should be kept. Three refinements are required before this spec is implementable; two are blocking.

### Required refinements

**1. (Blocking) Correct the threading scope: it is "fresh draft + fresh review," not "fresh + resume."**
The spec's checklist and Decision §3 commit to threading the snapshot "covering fresh and resume flows" and to the active spec dir being "excluded by name on both fresh and resume runs." This is contradictory against the code: the no-commit external boundary check only executes in two places, both on the **fresh** path — the pre-commit draft check (`run.ts:1044–1047`) and the fresh review phase (`run.ts:~1241`). The resume review phase runs with `checkBoundary: false` (`run.ts:710`) and never passes `externalSpecRoot`, so no external check runs on resume, and there is no capture site on that path. The spec must:
- Rewrite the threading requirement as "fresh draft check + fresh review phase."
- Resolve resume explicitly — either state resume is unaffected because its external check is disabled, or declare enabling-it-on-resume out of scope. The current "covering fresh and resume" language must not survive, as it describes a code path that does not exist.

*Why:* an acceptance criterion / checklist item that names a non-existent execution path is the paraphrase-of-unverified-behavior defect the spec guidance warns against; an implementer would either build dead code or be unable to satisfy it.

**2. (Blocking) Address the persisted-escape snapshot-poisoning interaction, and correct the "reverted as before" framing.**
In no-commit mode, a flagged escape is **not** reverted — `revertPaths` is gated on `commit` (`run.ts:1055`). A rogue sibling therefore persists on disk, and the next run's pre-write snapshot captures it as "pre-existing," permanently whitelisting it. The spec is silent on the run *following* a blocked escape. The spec must:
- Add an explicit decision acknowledging that an unreverted no-commit escape is whitelisted on the next run's snapshot, and state the disposition (e.g., operator must clean it up after the blocker; auto-revert in no-commit mode is out of scope). Silence is not acceptable for a known interaction that erodes the very escape-detection the intent says to preserve.
- Correct the inaccurate framing inherited from the intent ("still flagged and reverted as before"): in no-commit mode escapes are flagged-and-blockered but **not** reverted. Reviewers must not expect cleanup that does not happen.

**3. (Non-blocking, cheap) State the cost of the in-place-edit deferral, and the single-operator assumption.**
- Decision §4 defers detecting in-place edits to files inside a pre-existing sibling, justifying it only with "no cheap signal." Add that the deferred surface includes `ready-intents/`, which is both a legitimate sibling and a consumed pipeline input — undetected edits there could corrupt later `plan` inputs. The deferral may stand, but the cost belongs on the record, not just the rationale.
- Add a one-line assumption that the snapshot model presumes no concurrent plan runs over one project root (consistent with the single-operator constraint), since a concurrent run's later-created spec dir would be flagged.

### Not requiring change
The `git: false` boundary-enforcement preservation AC (cite-the-test form) is correct — that test's offending dir is created *during* the run, so a pre-run snapshot keeps it flagged. Snapshot-over-allowlist (Decision §1) and the behavioral ACs are sound.
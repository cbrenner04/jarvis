## Verdict

### Required outcomes

1. **Default recovery probe must classify signal and timeout kills like the ready gate.**  
   When the live `runRecoveryProbe` default runs `bun test` via `execFileSync`, subprocess kills must surface exit codes `124`, `130`, or `143` (not a generic `1`) so probe 1 immediately blocks recovery and does not fall through to failing-file extraction and probe 2. This matches the subspec blocking taxonomy and AC 8 (`isGenuineTestFailure` / `scripts/ready.ts` parity). Today only the injected probe path is correct; the production default path is wrong when Node sets `error.signal` with a null `status`.

2. **That behavior must be covered by a test on the default (non-injected) probe path.**  
   Injected tests that return `130`/`143` directly do not exercise the default runner. Add coverage that simulates the real `execFileSync` error shape (null `status`, `signal` set, and timeout `124` if applicable) and asserts recovery is refused with no probe 2.

### Rationale

The implementation matches the subspec state machine, typed eligibility, probe order, exact recovery stdout, docs in `v2/docs/v1-behaviors.md`, and injected-path acceptance criteria. The remaining gap is production-path correctness: an operator interrupt or signal kill during probe 1 could be misread as a recoverable test failure and trigger an unauthorized probe 2, violating the spec’s fail-closed contract for signal/timeout exits.

### Not required for this verdict

- HEAD-sha commit check-runs vs branch `gh pr checks` mismatch (explicit spec choice; docs already cover forward dual-CI case).
- Untested default `fetchCommitChecksForSha` / `resolveOwnerRepoFromWorktree` wiring (seam strategy satisfies ACs; mocked fetch tests are follow-up hardening).
- Cap-8, relative-path extraction, empty/pending CI adapter cases (implementation present; test gaps are regression hardening, not spec violations).
- Duplicated signal constants vs `scripts/ready.ts` (hygiene only).
- Probe-2 explicit signal guard (outcome already correct via non-zero refusal).

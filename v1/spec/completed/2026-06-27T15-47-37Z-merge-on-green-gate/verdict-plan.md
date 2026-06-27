## Verdict

Seven refinements required. The spec is otherwise sound.

**1. CI polling timeout (load-bearing decision missing)**
The spec commits to waiting on pending checks but sets no bound. A stalled check never resolves; the command hangs indefinitely. The Decisions section must specify a polling timeout (e.g., a configurable ceiling, default ~30 min), the behavior on timeout (abort, non-zero exit, report the still-pending check name), and must not defer this — the implementer is the first consumer.

**2. CI check state classification incomplete**
`gh` exposes states beyond success/failure/pending: `cancelled`, `skipped`, `neutral`, `action_required`, `timed_out`, `stale`. The spec's green/pending/red buckets leave these unmapped. Because the refusal message names the specific failing check, the classification is operator-visible and must be a Decisions entry. At minimum: which states count as green (pass), which cause waiting (pending), and which abort (red).

**3. Polling mechanism unspecified**
The injectable `ghRunner` seam is incompatible with a streaming `gh pr checks --watch` subprocess. The Decisions section must commit to a pollable mechanism (e.g., periodic `gh pr checks --json` on a fixed interval) so the seam has a defined contract and tests can be written against it.

**4. `--merge --mark-ready` mutual exclusivity**
The spec is silent on both flags being passed together. Since `--merge` subsumes `--mark-ready`, this combination should be a usage error. One line in Decisions; absence forces the implementer to guess.

**5. Doc-update line reference is fragile**
The `v2/docs/v1-behaviors.md` update instruction references `line ~31`. Replace with the section heading (`triage --mark-ready` entry) so the instruction survives file edits.

**6. Missing AC: local gate failure on already-ready PR**
AC5 covers the happy path (already-ready PR proceeds to merge). The gate order decision (local gate runs first, unconditionally) implies an already-ready PR with a failing local gate must also be refused. No acceptance criterion covers this observable outcome. Add an AC or extend AC3 to make this explicit.

**7. AC7 is structural, not behavioral**
AC7 mandates a testing artifact ("unit tests cover X using an injected gh runner"). Per spec guidance, ACs must describe observable behavior, not implementation structure. Rewrite as the behavioral claim (all listed scenarios behave correctly) or remove from ACs; the test approach belongs in the task checklist only.
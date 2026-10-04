Reviewing the implementation and advocate response against the spec before issuing a verdict.
## Verdict

**1. Remove duplicated paragraph in `v2/docs/write-behavior.md` (required).** The **Resume vs run resume** note repeats the terminal-refusal / branch-key / wire-shape / `run resume` distinction verbatim after the first occurrence. That is accidental paste, contradicts the documentation standard (one durable home; no duplication), and must be trimmed to a single paragraph before merge.

**2. Add a resume malformed-envelope test for `{ kind: "resumed" }` with missing or empty `pipelineId` (required).** The subspec task checklist requires that shape to parse as `invalid daemon response` with no stdout. `parsePipelineMutationOutcome` implements this, but the only resume malformed test feeds `{ kind: "unknown" }`, so regressions on bare or empty `pipelineId` would stay green.

**3. Add a resume success test where the CLI positional and daemon-returned `pipelineId` differ (required).** The decision ledger and implementer notes require echoing the daemon frame id, not the outbound RPC positional. Implementation reads `outcome.pipelineId` from the parsed response; every success mock uses matching ids, so substituting `params.pipelineId` would not fail today.

**No other actuator changes required.** The primary § Pipeline resume runbook update satisfies the named documentation ACs; the wedged-settlement subsection omission is a consistency nit outside acceptance criteria. An `@mutate` on the stdout write is optional hardening given the updated stdout pins. Core behavior (daemon id echo on resumed success only, approve/reject silent, refusal paths unchanged) matches spec.
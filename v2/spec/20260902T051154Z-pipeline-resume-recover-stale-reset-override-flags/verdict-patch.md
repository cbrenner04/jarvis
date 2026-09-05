Reviewing the documentation standard and relevant docs to adjudicate independently.
## Verdict

**Update `v2/docs/write-behavior.md`.** The pipeline resume/recover CLI contract table and the resume/recover prose still show flagless grammar and `{ pipelineId }` / `{ pipelineId, branchKey }` wire shapes only. Per `documentation-standard.md`, that file is the durable home for CLI input mapping. The shipped CLI admits both override flags and omits them from RPC params unless true; resume threads them into stale-reset preflight; recover forwards for RPC parity only. Leaving `write-behavior.md` stale contradicts the updated operator-runbook, v1-behaviors citations, and actual usage strings.

**No code changes.** Routed subspec acceptance is met: CLI forwarding, resume dispatch through shared stale reset with per-gate scope, recover RPC parity without preflight, and the operator-runbook/v1-behaviors updates in this branch match their subspecs.

**Do not change recover help text under current spec.** Subspec 00 requires reusing workflow stale-reset flag metadata in `command-help-flags.ts`; recover descriptions that read like workspace retirement are a spec-accepted tradeoff, not an implementation defect. Fixing operator confusion needs a spec amendment for recover-specific help copy, not a code fix now.

**No other actuator work.** Remaining gaps — unchecked `intent.md` umbrella criteria, one-way cross-link from resume to incomplete re-run gates, resume override scope limited to failed-stage reopen paths, omitted PR/multiple-open-PR refusals in resume prose, missing combined-flag recover test, unpinned strict-parse tests — are housekeeping, polish, or explicitly out of scoped acceptance. They do not block declaring the feature complete once `write-behavior.md` aligns.
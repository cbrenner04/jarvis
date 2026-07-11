## Verdict

The draft is not runnable as written. Its two subspecs both depend on `intent.md` being on disk in the worktree and on a completion contract that can distinguish a blocker failure from a missing-index failure, but neither mechanism is specified, and several decisions cite v1 as a "straight port" where the v2 seams differ. The following refinements are required before this spec is sound.

### Required refinements

1. **Name the actor and seam that places `intent.md` into the worktree.** The current decision says "the builder copies the ready-intent … before the agent runs," but the builder runs pre-daemon, before the worktree/spec dir exists — it provably cannot do this. Both subspecs' blocker and audit design rest on `intent.md` existing on disk at run time, yet nothing wires it. The spec must name the real actor (e.g. a run-time worktree-seed step, or the intent content threaded as a write-step input that the step writes before invoking the agent) and record the ruled-out alternative.

2. **Specify prompt-placeholder wiring.** The `plan.prompt.draft` prompt declares required placeholders (`WORKDIR`, `NAME`, `INTENT`, `SPEC_GUIDANCE`); a missing required placeholder fails the render. The spec pins `promptId` but never states which placeholders the step supplies or where `SPEC_GUIDANCE` comes from in v2. This is distinct from the durable `intent.md` file (which is the blocker/audit target) — both the file and the placeholders are needed. Add the placeholder-supply decision and an acceptance criterion that the built step renders `plan.prompt.draft` with all required placeholders satisfied.

3. **Reconcile the prompt's output path with the timestamped spec dir.** The prompt instructs the agent to write to a literal `spec/<NAME>/`; v1 rewrites that to the real target dir at draft time. The spec dir here is `<targetDir>/<UTC-timestamp>-<name>/`. Without an equivalent rewrite (or `WORKDIR`/`NAME` values that make the paths reconcile), the agent writes to one path and the contract inspects another. The spec must pin how the agent's output path and the inspected path are made to agree.

4. **Specify the contract-injection seam and a failure-reason channel.** Subspec 01 says to "replace the completion contract with the ported plan-draft validation," but the existing write step hardcodes its contract and exposes no parameter to inject one, and a boolean contract check carries no message. AC-4 requires the blocker case to be reported as a prerequisite/blocker failure *distinct from* a missing-index failure — which needs a reason channel that does not yet exist. The spec must state that the write-step API is extended to accept the plan validation and to surface a distinct failure reason, and record the ruled-out alternative.

5. **Correct the v1 blocker-porting claim.** Subspec 01 cites v1's `validateDraftOutput` as the ported shape check, but in v1 a blocker returns `valid: true` and the non-zero exit is handled in a separate branch. The spec requires blocker → workflow failure, which inverts that result. The decision must state that a genuine blocker maps to a contract *failure* (with the blocker reason surfaced), not a pass, so the citation no longer misleads the implementer about actual v1 behavior.

6. **Thread the known pre-run intent for `intentBefore`.** The blocker gate requires `intent.md` to be unchanged except for an appended `## Blocker`. Because the preset copies a known ready-intent in, the pre-run content is known to the harness — but the spec never says to retain it and thread it into the validation. Specify how the baseline intent content is captured and compared.

### Minor refinements (one decision line or AC each)

7. **Re-run / branch collision.** The preset pins `plan/<name>` untimestamped with no re-run story. State the behavior on a second run of the same ready-intent (error, resume, or reuse), or record `Deferred to first consumer` if out of scope.

8. **Timestamp generation point.** Pin who generates the spec-dir timestamp and when, since the path must be stable across the run. (No forbidden-API concern applies — this is ordinary `v2/src` TypeScript.)

9. **Ready-intent location vs `--target-dir` divergence.** The explicit `--ready-intent <path>` and the draft-root `--target-dir` can point at different trees. Add one decision resolving the divergence (error, allow, or derive target dir from the intent's `ready-intents/` parent).

10. **Config-passing branch.** Confirm the `plan` preset is added to the branch that supplies `configPath`, since plan needs it for its own target-dir precedence resolution.

### Rationale

Findings 1–6 are load-bearing mechanism decisions where a competent implementer would plausibly choose differently, the choice is costly to reverse, and the current text either names an actor that cannot act (1), omits the seam entirely (2, 4), or cites v1 in a way that misstates the actual behavior (3, 5, 6). Under the decision-ledger and "cite the test, don't paraphrase" quality principles, each of these must name its ruled-out alternative and reflect verified v1 behavior rather than an assumed port. Findings 7–10 are smaller but each removes a genuine ambiguity in operator-observable behavior.

### Rejected

- The claim that `Date.now()`/`new Date()` is forbidden here is wrong: that restriction applies to Workflow-tool scripts, not `v2/src` source. Only the "where is the timestamp generated" clarification (finding 8) stands.
- No dedicated AC for the interim `index.md`-exists contract is required; subspec 00 already documents it as intentional and superseded by subspec 01.
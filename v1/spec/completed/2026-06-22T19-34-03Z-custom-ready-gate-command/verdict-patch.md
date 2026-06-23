All three findings confirmed against the code. Issuing the verdict.

---

## Verdict

The invocation threading is faithfully wired and well-tested, but three operator/agent-facing surfaces still hardcode the literal string `bun run ready`, so a project with a custom `readyCommand` sees self-contradictory or misdirecting output. Two of these directly undercut accepted criteria and the intent. The actuator must address the following.

### Required outcomes

1. **Terminal stuck-red failure surfaces must not contradict the command they report.**
   The two exit-10 surfaces in the completion pipeline (the post-fixup "failure unchanged" and "stayed red for N iterations" messages) prepend a literal `bun run ready failed:` header to a `failureText` that already names the configured command (the gate runner builds its error as `<displayCmd> failed:\n<captured>`). With a custom `readyCommand` the operator sees `bun run ready failed:` wrapping an inner error that names a different command — a self-contradictory surface. AC#4 requires the surfaced failure to name the configured command; the embedded `failureText` satisfies that, but the redundant hardcoded prefix actively violates it. Outcome: these terminal surfaces must name (or defer to) the actually-run command, not a hardcoded `bun run ready`. These are the surfaces the operator acts on, so correctness here matters.

2. **The red fix-up prompt must point the agent at the command that actually failed.**
   The fix-up prompt instructs the agent to "Fix the cause of this `bun run ready` failure." On a custom-command repo `bun run ready` never ran, so every red fix-up iteration misnames the failing command. This works directly against the feature's stated intent — keeping the agent from flailing on a gate it can't satisfy — by sending it after the wrong command. The prompt preamble already embeds the command-named `failureText`, so the hardcoded command name should be removed or generalized (e.g. refer to "the completion ready gate failure"). Uncovered by any current AC; must be fixed.

3. **Align the remaining gate-behavior doc prose with the override.**
   The spec's third documentation item requires updating *any* `v1/docs` ready-gate description that states the gate runs `bun run ready`. `v1/docs/worktrees-and-commits.md:221` is a direct behavioral description of the gate ("the `bun run ready` gate runs… On gate failure, the PR remains draft") and was missed; it must note the per-project `readyCommand` override. The `workflows.md` mermaid node labels are schematic, not behavioral prose, and `run-loop.md` (already updated) is the canonical reference — updating them is optional, not required.

### Not required

Broadening stuck-red output normalization to cover arbitrary custom-command output is out of scope: normalization behavior is unchanged by this spec, the hazard is pre-existing and shared with `bun run ready`, and one cannot normalize output formats one has never seen. No action.
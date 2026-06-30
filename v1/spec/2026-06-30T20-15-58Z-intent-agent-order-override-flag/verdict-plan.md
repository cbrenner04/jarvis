## Verdict — required refinements

1. **Pin early validation and substitution.** Require `--agent` parse/validate and in-memory `modes.plan.agentOrder` substitution immediately after `loadConfig`, before `enterMode` and before worktree/branch/PR or external staging setup — same ordering as plan. The spec currently pins substitution only before `runIntentSplitTurn`; a later-only read allows bad flags to pass seed checks and create `intent/<name>` artifacts.

2. **Reconcile operator docs that currently deny the flag.** Documentation updates must explicitly fix contradictions, not only add intent coverage:
   - `v1/docs/agents.md` — remove/replace the line stating intent does not accept `--agent`; add intent scope boundary (intent-split only; `prompt` still excluded) and an intent example beside run/plan.
   - `v1/docs/config.md` — extend the per-run `--agent` bullet to include `jarvis1 intent`.
   - `v1/docs/operator-runbook.md` — extend the one-run actuator-probe guidance to include `jarvis1 intent`.

3. **Revise existing v1-behaviors bullets, not only append.** `v2/docs/v1-behaviors.md` L173 (“reuses the plan agent order”) and the intent flag inventory (~L165) must be updated to state config-default ladder with per-invocation `--agent` override for intent-split; acceptance criteria or documentation updates must require revising those lines, not only adding new ones.

4. **Anchor the no-flag preservation AC.** Replace “behaves as before” with a citation to `intent-command.sandbox-unrunnable.test.ts` stays green (per spec-guidance for preservation ACs).

5. **Split missing vs invalid `--agent` error ACs.** Invalid values exit via `prefixAgentFlagError` with `intent:` prefix; missing values exit during `parseIntentArgs` with `intent:` prefix — plan parity. Do not attribute both to `prefixAgentFlagError` alone.

6. **Record supersession of the plan override exclusion.** Add a decision noting this spec supersedes `02-plan-agent-override.md`'s “intent does not accept `--agent`” boundary for intent-split only; `jarvis1 prompt` remains out of scope.

---

**Rationale:** Items 1–2 prevent observable operator/runtime defects (orphaned worktrees, doc lies). Items 3–5 align with spec-guidance (v1-behaviors parity for behavior changes; preservation AC test anchors; accurate error contracts). Item 6 prevents cross-spec confusion from an explicit prior exclusion.

**Not required:** No-commit-specific AC (task checklist already covers both paths; adapter limits inherited). `:model` fallback source (implied by shared parser reuse). `intent-mode.md` cross-link (no hard negative; optional). Dedicated CLI-help AC (discoverability gap only; agents.md AC may suffice). Explicit `agentFlags` field name (plan pattern is sufficient).

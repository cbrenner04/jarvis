## Verdict: refinements required before merge

The draft matches intent on scope (prompt-only), suffix fallback, reject-on-other-modes, and doc targets. Gaps below would let an implementer ship broken CLI, wrong telemetry, or docs that defer decisions this subspec must pin.

### Required refinements

1. **Pin `--agent <name>:<model>` vs `--model` precedence** — Remove deferral for this subspec; add a decision line choosing one winner when both specify a model. First consumer is this feature; docs and parsing cannot ship with “once conflict syntax is pinned.”

2. **Pin validation timing** — Add a decision that unknown/malformed `--agent` is rejected in CLI parsing / `main()` before worktree creation or agent invocation (same layer as `--repo` and empty-text checks). Revise the bogus-agent AC to require no worktree side effects, not merely “before agent invocation.”

3. **Empty `agentOrder` with `--agent`** — Decision allows a pinned-only effective list, but current behavior exits when the built list is empty. Add an AC: `--agent <valid-name>` with empty `modes.prompt.agentOrder` runs only the pinned agent (effective list length 1).

4. **Core verification AC** — Add an AC that pins an agent absent from `modes.prompt.agentOrder` (e.g. `opencode` when order is `claude,cursor`) and confirms it is attempted first. This is the primary intent; order-reorder AC alone does not cover config-surgery avoidance.

5. **Complete model override surface** — Colon syntax has an AC; add AC for standalone `--model` on the pinned agent. Add AC(s) for model resolution when the pinned agent has no CLI model: from matching `agentOrder` row, else agent default (covers decision steps 3–4).

6. **Effective list carries model through invocation and telemetry** — Extend task/AC so the effective-list builder replaces `buildActivePromptAgents` with per-entry `{ agent, model }` used for invocation and summary/telemetry attribution. “Preserve telemetry policy” is insufficient: pinned agents absent from config or using override models would misreport `configuredModel` today.

7. **Malformed `--agent` handling** — Add AC(s) mirroring `--repo`: missing value, duplicate `--agent`, empty agent name → usage error, exit non-zero (prefer exit `1` to match existing CLI validation), no agent invocation.

8. **CLI parsing contract AC** — Decision pins subcommand-local parsing; add AC that `--repo`, `--agent`, optional `--model`, and multi-word prompt text combine correctly (flags before positional text; quoted prompt preserved). Rules out ambiguity about “global” vs subcommand argv.

9. **Dedup suffix behavior** — Add AC: when `--agent` names an agent already present in `agentOrder`, that agent runs once (pinned first), config duplicate skipped in suffix.

10. **Supported-agent validation source** — Replace hardcoded agent enumeration in the decision with “valid names per `AGENT_NAMES` / `isAgentName`” (or cite `config.ts`). Error text must list the derived set so new agents do not stale the spec.

11. **Test coverage split** — Task/AC must require `parseArgs` tests in `cli.sandbox-unrunnable.test.ts` (flag parsing, validation, malformed flags) plus `promptCommand` integration tests (effective list, fallback, telemetry model). `run.test.ts` green-without-flag only guards the no-flag path.

12. **Operator-runbook AC** — Revise from “remove config-surgery workaround” to: document `jarvis1 prompt --agent` as prompt-mode agent verification; cross-link seed `per-run-agent-override-flag` as future cross-mode override tracker. No deletion target exists in runbook today (L139 references the seed, not reorder surgery).

13. **Seed relationship in durable docs** — `operator-runbook.md` and `v1-behaviors.md` obligations should state: prompt `--agent` satisfies prompt verification now; `per-run-agent-override-flag` remains the tracker for `run`/`plan`.

14. **Resolve doc deferral for model conflict** — Once #1 is pinned, remove “once conflict syntax is pinned” from `specless-prompt.md` doc obligation; document the chosen precedence.

### Optional (non-blocking)

- AC that `jarvis1 prompt --help` mentions `--agent`.
- One-line `--agent` precedence cross-link in `config.md`.
- Runbook note that verification runs may fall through on quota when suffix agents remain (decision-defended; operator clarity only).

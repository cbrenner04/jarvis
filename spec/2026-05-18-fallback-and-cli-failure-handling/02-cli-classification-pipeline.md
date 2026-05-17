# 02 — CLI classification pipeline (spawn + post-process)

## Problem

`src/agents/spawn.ts` merges **stderr + stdout** into diagnostics for non-zero exits, then classifies **model_config → quota (strict) → error**. Plan and patch then apply **`applyQuotaFallbackWhenAllowed`** with mode-specific guards. Timeouts and SIGINT are handled in patch outside spawn.

New contributors cannot see the **end-to-end pipeline** in one place; extension points (new agent, new weak patterns, `weakQuotaExitCodes`) are scattered across call sites.

## Decisions

- **Documentation-first:** add a short pipeline section (diagram or numbered list) reachable from `docs/quota-signals.md` or a dedicated **`docs/agent-cli-failure-pipeline.md`** — choose whichever avoids bloating `run-loop.md`.
- **Code clarity (optional in this subspec):** thin wrappers or a single `classifyAgentFailure` module **only if** it reduces duplication **without** changing behavior; behavior changes belong in explicit acceptance criteria + tests.
- Field naming: **`AgentResult.stderr`** sometimes carries merged stdout; document **legacy naming** unless a rename is trivially worth doing (if renamed, update types + all sites in one iteration).

## Task checklist

- [ ] Enumerate every `agent.run` callsite and post-classification branch (patch iteration, plan interview/draft/review/name-only, any others).
- [ ] Write pipeline doc with ordering: spawn → `AgentResult` → mode guard → user-visible outcome.
- [ ] Optionally refactor for readability; no semantic change unless accompanied by tests.

## Acceptance criteria

- [ ] Pipeline doc merged and linked from `docs/quota-signals.md`.
- [ ] Callsite inventory in the doc matches `rg 'agent\\.run'` / equivalent audit at implementation time.
- [ ] If any refactor lands: `bun run typecheck` and `bun test` pass with no intentional behavior change (or behavior change explicitly listed in this subspec’s acceptance criteria and tested).

## Documentation updates

- [ ] New or updated doc file as decided above.
- [ ] `docs/quota-signals.md` link from intro or Pattern audit section.

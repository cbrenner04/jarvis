---
name: implement-rules-omit-the-lint-contract
---

# Implement rules omit the lint/format contract, so codex red-gates deterministically

## Problem

`prompts/patch/rules.md` (injected into both v1 and v2 implement prompts) tells the agent to run
`bun run typecheck` and `bun run test`, and says only "Match style. No unrelated formatting." It
never mentions `bun run check` / biome, the formatter, or lint rules like `noNonNullAssertion`. The
completion gate *does* run biome. So an agent whose priors are biome-clean (claude) passes; an agent
that writes `foo!` and unformatted code (codex `gpt-5.6-terra`) red-gates **deterministically** —
observed 4/4 implement PRs on 2026-07-17 — and the gate-repair loop can't autofix `noNonNullAssertion`
(biome `fix:none`). This is a top driver of "every implement PR needs a human finisher" and of codex
quota burn (repair-loop churn).

## Decisions

- Add the lint/format contract to `prompts/patch/rules.md`: instruct running `bun run fix` (biome
  autofix) and forbid non-null assertions (`!`) before ticking AC / completing; rules out relying on
  an agent's implicit style priors to satisfy a gate it was never told about.
- Keep it actuator-agnostic (helps codex/cursor without regressing claude); rules out per-agent prompt
  branches.

## Out of scope

- Changing `biome.json` rule severities.
- The gate-repair loop's iteration budget.

## Documentation updates

- `v2/docs/v1-behaviors.md` / `v1/docs/operator-runbook.md` — note rules now cover the biome gate.

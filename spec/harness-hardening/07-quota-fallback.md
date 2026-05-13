# 07 — Quota in-loop fallback

## Problem

Quota detection is pattern-based against vendor stderr strings. When a
pattern misses (vendor reworded their message, or the quota signal is
indirect like a 429-coded HTTP error from a deeper layer), the iteration
returns `kind: "error"` and the run exits 3 — *without* trying the next
agent in `agentOrder`. A real quota error becomes a hard failure that the
operator must re-trigger manually with a different agent.

## Behavior

When an iteration returns `kind: "error"` (not `quota`, not
`model_config`), `runCommand` inspects the result and decides whether to
treat it as a probable-quota event:

- If the exit code is in a configurable set of "rate-limit-shaped" codes
  (default: empty; this is intentionally opt-in until subspec 08 has
  data), OR
- If the stderr matches a *weak* quota regex set (`\b429\b`, `\b503\b`,
  `\brate.?limit/i`, `\btoo many requests/i`) AND the iteration produced
  no progress (no criteria checked, no files changed)

then jarvis falls back to the next agent in `activeAgents` exactly as it
would for a strict `kind: "quota"` result. It emits a harness log line
naming the fallback and the original error.

If no fallback agents remain, the run exits as today (`exit 2` for the
all-exhausted case).

The strict `kind: "quota"` path is unchanged. The weak path is a safety
net, not the primary detector.

A test agent harness is added that lets tests assert: "given this stderr
and exit code, did the run fall back to the next agent?"

## Tasks

- [ ] Add a weak-quota classifier in `src/agents/quota.ts`:
      `isWeakQuotaSignal(name, exitCode, stderr): boolean`.
- [ ] In `runCommand`, on `kind: "error"`, run the weak classifier. If
      true and no progress was made, treat as quota.
- [ ] Config key `quotaFallback: "strict" | "lenient"` (default
      `"lenient"`). Strict disables the weak path.
- [ ] Tests: a synthetic agent that exits with stderr `HTTP 429: too many
      requests` triggers fallback under lenient; same agent under strict
      exits 3 as today.

## Acceptance criteria

- [ ] Under the default (`lenient`), a non-strict-match quota-shaped error
      with no progress causes fallback to the next agent.
- [ ] Under `strict`, the same input exits 3 (unchanged behavior).
- [ ] A real error (compile failure, syntax error in stderr) is NOT
      misclassified as quota under lenient mode; tests cover this.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `docs/quota-signals.md`: document the weak-quota safety net and the
  `quotaFallback` config knob.
- `docs/config.md`: list `quotaFallback`.

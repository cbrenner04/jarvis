# 03 — Opencode quota signals

## Problem

`src/agents/quota.ts` maps per-agent exit codes and stderr substrings to
`quota` or `model_config` results. Opencode is a wrapper over arbitrary
providers, so the surface area of possible quota/error messages is wider
than for a single-provider CLI like `claude`. The harness still needs
deterministic detection so fallback works.

This subspec documents the initial signal set and wires it into
`quota.ts`. Coverage will grow as real-world failures are observed.

## Decisions

- Detection is best-effort and based on substring matching against
  `stdout + stderr`. False negatives surface as `kind: "error"` (current
  behavior for unknown failures); false positives are worse, so the
  initial set is conservative.
- Initial **quota signals** (case-insensitive substring matches anywhere
  in combined output):
  - `"rate limit"` paired with a non-zero exit code.
  - `"quota exceeded"`.
  - `"insufficient_quota"` (OpenAI-compatible error code).
  - `"429"` appearing in an error line (heuristic; many providers surface
    HTTP 429 in error text).
  - `"you have exceeded your"` (common Copilot phrasing).
- Initial **model_config signals** (case-insensitive):
  - `"model not found"`.
  - `"unknown model"`.
  - `"unsupported model"`.
  - `"invalid model"`.
  - `"no provider configured for"` (opencode-specific phrasing when the
    provider half of `provider/model` is wrong).
- These signals are added to opencode-only branches in `quota.ts`. Existing
  per-agent signal logic for claude/codex/cursor is **not** touched.
- Detection only triggers when the exit code is non-zero. A successful run
  containing the substring (e.g. an agent quoting "rate limit" in
  conversational output) does not flip the result.

## Tasks

- [ ] Extend `src/agents/quota.ts` so `isQuotaSignal` and
      `isModelConfigurationSignal` handle the `"opencode"` agent name with
      the substrings listed above.
- [ ] Keep the implementation simple (a per-agent switch with an
      opencode-specific list is fine; do not refactor existing branches).
- [ ] Add tests for each substring in both `isQuotaSignal` and
      `isModelConfigurationSignal` so regressions surface immediately.
- [ ] Add a test that ensures a `code === 0` run does not get reclassified
      as `quota` even when output contains a matching substring.
- [ ] Update `docs/quota-signals.md` with the opencode section listing the
      same substrings and a short note that the list is expected to grow.

## Acceptance criteria

- `bun run typecheck`, `bun test`, and `bun run check` pass.
- An `OpencodeAgent` failure where stderr contains `"rate limit reached"`
  returns `kind: "quota"`.
- An `OpencodeAgent` failure where stderr contains `"model not found"`
  returns `kind: "model_config"`.
- A successful (`code === 0`) opencode run still returns `kind: "ok"` even
  if stdout mentions one of the substrings.

## Documentation updates

- `docs/quota-signals.md` — append an `## Opencode` section. (Counted as
  spec-required docs, not part of subspec 05.)

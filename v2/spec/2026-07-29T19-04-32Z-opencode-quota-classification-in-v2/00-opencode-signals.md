# Teach the shared classifier opencode signals

## Problem

`shared/invocation/agents.ts` classifies only claude/codex/cursor. `AgentName`
is `"claude" | "codex" | "cursor"`, so the opencode binding sets
`classifier: "cursor"` (agents.ts:707) and `quotaPatternsFor` defaults to
the claude table for anything unknown. Result: opencode's own quota phrasing,
its `no provider configured for` model-config error, and its guarded HTTP 500
(`UnknownError`) stall are misclassified — quota may not escalate, the
provider-config error is not terminal `model_config`, and the 500 is not
retried as transient.

v1 already carries the correct opencode signals (`v1/src/agents/quota.ts`);
port them into the shared classifier.

## Decisions

Widen `AgentName` to include `"opencode"`; route the opencode binding through
its own classifier — rules out keeping the `classifier: "cursor"` reuse, which
cannot distinguish opencode-only signals.
Port v1's opencode pattern tables verbatim: `opencodeQuotaPatterns`,
`opencodeModelConfigurationPatterns` (union with the shared model-config table,
matching v1), `opencodeTransportPatterns` (guarded 500 + `unknownerror`
context) — rules out inventing new phrasing not backed by v1's field record.
Extend the shared `guardedStatusPatterns` helper with an optional context-words
argument so the opencode 500 pattern can add `unknownerror`; opencode transport
is opencode-only and does not widen 500 matching for other agents — rules out a
global 500 add that would retry non-opencode 500s.
The opencode `SpawnConfig.name`/`classifier` become `"opencode"`; the stale
comment at agents.ts:689 explaining the cursor reuse is removed.

## Tasks

- [ ] Add `"opencode"` to `AgentName`.
- [ ] Add `opencodeQuotaPatterns`, `opencodeModelConfigurationPatterns`,
      `opencodeTransportPatterns` ported from v1, and route them in
      `quotaPatternsFor`, `isModelConfigurationSignal`, and `isTransientSignal`.
- [ ] Set the opencode binding's `name`/`classifier` to `"opencode"`; drop the
      obsolete cursor-reuse comment.
- [ ] Update `v2/docs/shared-invocation.md` and `v2/docs/v1-behaviors.md`
      (line 377 divergence) to reflect opencode's own classifier.

## Acceptance criteria

- [ ] An opencode invocation whose diagnostics carry an opencode quota message
      (e.g. `rate limit`, `quota exceeded`, `insufficient_quota`, guarded 429,
      `you have exceeded your`) classifies as `quota` and escalates off the
      rung. A new/updated test in `shared/invocation/agents.test.ts` asserts
      this and fails against the pre-fix code (which settles it as `error`).
- [ ] An opencode invocation returning `no provider configured for` classifies
      as `model_config` (terminal). A new/updated test in
      `shared/invocation/agents.test.ts` asserts this and fails against the
      pre-fix code.
- [ ] An opencode invocation returning a guarded HTTP 500 (including
      `UnknownError` context) classifies as transient and is retried by the
      bounded retry loop rather than settling as a hard failure. A new/updated
      test in `shared/invocation/agents.test.ts` asserts the retry and fails
      against the pre-fix code.
- [ ] Inverting each added guard (opencode quota, opencode model-config,
      opencode transport routing) makes at least one test in
      `shared/invocation/agents.test.ts` fail — the negative case for each new
      classification proves the effect is absent when the guard is removed.
- [ ] Existing claude/codex/cursor classification tests in
      `shared/invocation/agents.test.ts` stay green (opencode routing does not
      alter other agents' behavior).

## Documentation updates

- `v2/docs/shared-invocation.md`: replace "reuse the `cursor` classifier"
  (line 63) with opencode's own quota/model-config/transient classification.
- `v2/docs/v1-behaviors.md`: update the line-377 divergence entry — opencode
  quota/model-config/500 now classify like v1, no longer settling as terminal
  `error`.

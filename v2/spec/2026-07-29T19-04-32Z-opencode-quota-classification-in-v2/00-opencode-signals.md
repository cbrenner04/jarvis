# Teach the shared classifier opencode signals

## Problem

`shared/invocation/agents.ts` classifies only claude/codex/cursor. `AgentName`
is `"claude" | "codex" | "cursor"`, so the opencode binding sets
`classifier: "cursor"` (agents.ts:707). opencode therefore routes through the
**cursor** quota/model-config/transient tables — not the claude default (that
clause describes only a hypothetical unknown agent opencode never reaches).
The cursor tables miss opencode's phrasing, so opencode's quota settles
`error` (does not escalate), its `no provider configured for` model-config
error is non-terminal, and its guarded HTTP 500 (`UnknownError`) stall is not
retried as transient.

v1 already carries the correct opencode signals (`v1/src/agents/quota.ts`);
port them into the shared classifier.

`isTransientSignal` and `isModelConfigurationSignal` currently discard their
agent-name parameter (`_name`); the transient path is reachable only through
the non-zero-exit settlement (the zero-exit path checks quota only, and the
opencode finalize step no-ops on non-ok results, verified against v1's shared
`exitCode !== 0` guard).

## Decisions

Widen `AgentName` to include `"opencode"`; route the opencode binding through
its own classifier — rules out keeping the `classifier: "cursor"` reuse, which
cannot distinguish opencode-only signals.
Port v1's opencode pattern tables verbatim: `opencodeQuotaPatterns`,
`opencodeModelConfigurationPatterns` (union with the shared model-config table,
matching v1), `opencodeTransportPatterns` (guarded 500 + `unknownerror`
context) — rules out inventing new phrasing not backed by v1's field record.
Un-ignore the `_name` parameter on `isTransientSignal` and
`isModelConfigurationSignal` and thread the classifier through both so the
opencode tables route (v1 already consumes the name) — rules out leaving the
parameter discarded, which cannot select opencode-only signals.
Bring the shared `guardedStatusPatterns` helper up to v1's existing signature —
an optional context-words argument (v1's helper already carries it; the shared
helper does not) — and pass `unknownerror` for the opencode 500 pattern only;
opencode transport is opencode-only and does not widen 500 matching for other
agents — rules out a global 500 add that would retry non-opencode 500s.
The opencode `SpawnConfig.name`/`classifier` become `"opencode"`; the stale
comment at agents.ts:689 explaining the cursor reuse is removed.

## Tasks

- [ ] Add `"opencode"` to `AgentName`.
- [ ] Add `opencodeQuotaPatterns`, `opencodeModelConfigurationPatterns`,
      `opencodeTransportPatterns` ported from v1, and route them in
      `quotaPatternsFor`, `isModelConfigurationSignal`, and `isTransientSignal`
      (un-ignoring the `_name` parameter on the latter two).
- [ ] Set the opencode binding's `name`/`classifier` to `"opencode"`; drop the
      obsolete cursor-reuse comment.
- [ ] Update `v2/docs/shared-invocation.md` and `v2/docs/v1-behaviors.md`
      (line 377 divergence; edit only the quota/model-config/500 clauses,
      leaving any unrelated divergence content on that entry intact) to
      reflect opencode's own classifier.

## Acceptance criteria

- [x] An opencode invocation (any exit code) whose diagnostics carry an
      opencode quota message (e.g. `rate limit`, `quota exceeded`,
      `insufficient_quota`, guarded 429, `you have exceeded your`) classifies
      as `quota` and escalates off the rung. A new/updated test in
      `shared/invocation/agents.test.ts` asserts this and fails against the
      pre-fix code (which settles it as `error`).
- [x] An opencode invocation returning `no provider configured for` classifies
      as `model_config` (terminal). A new/updated test in
      `shared/invocation/agents.test.ts` asserts this and fails against the
      pre-fix code.
- [x] An opencode invocation exiting non-zero with a guarded HTTP 500
      (including `UnknownError` context) classifies as transient and is retried
      by the bounded retry loop rather than settling as a hard failure. The
      transient path is reachable only via non-zero exit, so the fixture must
      exit non-zero. A new/updated test in `shared/invocation/agents.test.ts`
      asserts the retry loop re-spawns (spawn call count ≥ 2) and fails against
      the pre-fix code.
- [x] Inverting each added opencode guard — the `name === "opencode"` branch in
      quota routing, in `isModelConfigurationSignal`, and in
      `isTransientSignal` — makes at least one test in
      `shared/invocation/agents.test.ts` fail — the negative case for each new
      classification proves the effect is absent when the guard is removed.
- [x] Existing claude/codex/cursor classification tests in
      `shared/invocation/agents.test.ts` stay green (opencode routing does not
      alter other agents' behavior).

## Documentation updates

- `v2/docs/shared-invocation.md`: replace "reuse the `cursor` classifier"
  (line 63) with opencode's own quota/model-config/transient classification.
- `v2/docs/v1-behaviors.md`: update only the quota/model-config/500 clauses of
  the line-377 divergence entry — opencode quota/model-config/500 now classify
  like v1, no longer settling as terminal `error`; leave unrelated divergence
  content intact.

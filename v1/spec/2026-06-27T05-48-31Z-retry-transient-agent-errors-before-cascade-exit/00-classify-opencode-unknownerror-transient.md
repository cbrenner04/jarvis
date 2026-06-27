# Classify opencode UnknownError/500 as transient

## Problem

The spawn layer already rides out transient transport errors: `runAgent`
(`v1/src/agents/spawn.ts`) retries when `isTransientSignal`
(`v1/src/agents/quota.ts`) matches, bounded by 3 re-attempts with `[1s,2s,4s]`
backoff, before returning `kind: "error"`. But `isTransientSignal` only matches
`sharedTransportPatterns` (connection reset, broken pipe, 502/503/504/529, …) —
it does **not** match opencode's `UnknownError`/HTTP 500. So a single opencode
`UnknownError`/500 skips the retry loop, returns `kind: "error"`, and the patch
cascade classifies the iteration `agent-error` and exits 3 (`iteration.ts:1735`).

Teach the transient classifier to recognize opencode `UnknownError`/500 so the
existing retry loop rides it out. No new retry path.

## Decisions

- Extend `isTransientSignal` to recognize opencode `UnknownError` and HTTP 500 server errors; let the existing `runAgent` retry loop + `onTransientRetry` plumbing handle them. Rules out: adding an iteration/cascade-level retry around `binding.classify`, which the intent forbids ("reuse, don't invent").
- Reuse target is `isTransientSignal` (`v1/src/agents/quota.ts`) + the existing `runAgent` retry loop (`v1/src/agents/spawn.ts`). Rules out: `withSyncTransientRetry` (`v1/src/gh.ts`) — it is the synchronous git/gh retry driver, unrelated to async agent spawn retries; no hook there.
- Scope the new patterns to opencode by making `isTransientSignal` name-aware (it currently ignores `_name`); do not add them to `sharedTransportPatterns`. Rules out: broadening shared patterns, which would also change `isTransientNetworkError` git/gh retry and would mis-retry legitimate 500s from other agents.
- No call-site changes: both `runAgent` invocations in `spawn.ts` already pass `config.name` as the first argument to the classifier, so name-aware dispatch needs no caller edits. Rules out: auditing/threading a name argument that is already plumbed through.
- Guard the 500 pattern with error/http/status context, matching the existing 502/503/504/529 patterns. Rules out: a bare `\b500\b` match that fires on unrelated agent output.
- On retry exhaustion the result stays `kind: "error"` and the cascade still exits `agent-error` (exit 3), unchanged.
- Pin the exact `UnknownError`/500 regex phrasing against a real opencode stderr sample. Deferred to first consumer: exact stderr wording — opencode surfaces error text on stderr captured with the `opencode:` prefix (`v1/src/agents/opencode.ts:184`); ground the regex by capturing stderr from a failing `opencode run` invocation (or its error-event JSON shape) rather than guessing, and mirror the guarded form of the existing 502/503/504/529 patterns in `v1/src/agents/quota.ts`.

## Task checklist

- [ ] Add opencode-scoped `UnknownError` + guarded HTTP 500 patterns to the transient classification in `v1/src/agents/quota.ts`, name-aware via `isTransientSignal`.
- [ ] Unit-test the new classification and its opencode scoping.
- [ ] Confirm the existing `runAgent` retry loop rides out an opencode `UnknownError`/500 result.
- [ ] Update `v1/docs/quota-signals.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `isTransientSignal` returns true for an opencode result whose stderr matches `UnknownError` and for an opencode result with guarded HTTP 500 server-error phrasing (new cases in `v1/test/agents/quota.test.ts`).
- [ ] A non-opencode agent's generic `UnknownError`/HTTP 500 stderr is **not** newly classified transient by `isTransientSignal` (scoping case in `v1/test/agents/quota.test.ts`).
- [ ] `isTransientNetworkError` git/gh classification is unchanged by the name-aware change (`v1/test/gh.test.ts` stays green).
- [ ] An existing shared transport pattern (e.g. a 503 server error) still classifies transient for an opencode invocation after the name-aware change — name-aware dispatch falls through to `sharedTransportPatterns` (case in `v1/test/agents/quota.test.ts`).
- [ ] An opencode invocation that fails with `UnknownError`/500 is retried by the existing `runAgent` transient-retry loop (bounded cap + escalating backoff, `onTransientRetry` fired) instead of being returned immediately as `kind: "error"` (extended case in `v1/test/agents/spawn.sandbox-unrunnable.test.ts`).
- [ ] On retry exhaustion the opencode `UnknownError`/500 result still returns `kind: "error"` and the patch cascade still exits `agent-error` (exit 3); `v1/test/run.test.ts` agent-error path stays green (behavior unchanged on exhaustion).
- [ ] `v1/docs/quota-signals.md` and `v2/docs/v1-behaviors.md` document opencode `UnknownError`/500 as a transient transport class ridden out by the existing retry loop.

## Documentation updates

- `v1/docs/quota-signals.md` — add opencode `UnknownError`/500 to the transient transport errors section.
- `v2/docs/v1-behaviors.md` — update the patch-mode transient transport error retry section to note opencode `UnknownError`/500 is classified transient (changes existing v1 behavior).

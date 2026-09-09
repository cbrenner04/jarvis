# Quota Signals & Transient Errors

The shared invocation layer (`shared/invocation/agents.ts`) classifies each agent CLI exit as `ok`, `quota`, `model_config`, or `error` (plus `stall` from the idle watchdog). Vendors do not document stable exit codes, so the exit code is a guard and stderr/stdout text patterns decide. Fallback semantics — which kinds advance the agent order or the model rungs — live in [`agent-model-config.md`](./agent-model-config.md) and [`shared-invocation.md`](./shared-invocation.md); this doc owns the signal catalog and the real-sample record.

## Classification order

Non-zero exit, first match wins: **credential/auth → quota → transient → model configuration → error**. Auth and quota outrank a transient marker because an exhausted or de-authenticated agent never recovers on retry; a stray transport phrase elsewhere in the tail (the codex `shell_snapshot` noise line in the sample below) must not mask the banner and burn the retry cap with no fallback (#3372). Zero exit: Claude's verified stdout quota envelope, then Codex credential/auth phrasing on stderr (`authFailure: true`), then the agent's quota patterns over stderr+stdout, else `ok`.

## Transient transport errors

A transient transport error is a momentary network failure (connection reset, broken pipe, HTTP 502/503/504/529, `overloaded`, `service unavailable`) that exits non-zero but is not quota or code failure. `isTransientSignal` detects it and the runner retries the **same** agent on the **same** binding, capped at **3 re-attempts (4 total spawns)** with backoff **[1s, 2s, 4s]**. If every attempt fails the final result is `kind: "error"` for normal handling. Opencode additionally matches guarded HTTP 500 / `UnknownError` phrasing. An abort during backoff returns immediately; transient re-attempts do not reset iteration budgets.

## Credential/auth failures

A durable session/token error (refresh token revoked, re-authentication required, log out and sign in) classifies as **`quota` with `authFailure: true`**, so the run rotates to the next agent. Patterns are Codex-only (`codexCredentialAuthPatterns`, including the trusted-directory refusal `--skip-git-repo-check was not specified`); Claude and Cursor auth phrasing is deferred until a real sample lands. On zero exit the stderr-only auth check precedes the zero-exit quota check.

## Model configuration

`modelConfigurationPatterns` (`unknown model`, `unsupported model`, `model not found`, `not available for your account`, `LLM Provider NOT provided`, …; opencode adds `no provider configured for`) classify `model_config`. **`model_config` is terminal — it never advances the agent order.** A `model at capacity` refusal and an unauthenticated cursor both land here, so an agent in that state at the head of the order fails every run until fixed.

## Capture convention (real quota events)

Record real quota signals whenever you hit one during normal usage.

1. Copy the raw signal text from the failed run. Most agents deliver quota
   diagnostics on stderr; Claude may deliver a verified exit-`0` quota envelope
   on stdout JSON (see [Claude](#claude)). Keep wording and punctuation exactly
   as printed.
2. Redact secrets or personal identifiers only if needed.
3. Add an entry under the matching agent's observed-quota-samples section
   (`Observed quota samples` for Claude; `Observed quota stderr` for other
   agents) using this format:

```text
- YYYY-MM-DD — source context (command/repo/provider; stdout or stderr)

  ```text
  <verbatim signal block>
  ```
```

4. If the signal reflects model configuration (not quota), place it in
   `Observed model-configuration stderr (real samples)` instead.
5. Update the [Pattern audit](#pattern-audit-sharedinvocationagentsts) by changing the related pattern status
   from `Unverified` to `Matched` and linking the sample date.

Doc-only workflow is intentional: low friction beats extra tooling here.

## Claude

Claude runs with `--output-format stream-json --verbose --include-partial-messages`. On exit `0` the runner checks for a verified quota error envelope (`isClaudeZeroExitQuotaEnvelope`, `shared/invocation/claude-json.ts`): `is_error: true`, `api_error_status: 429`, and a quota message in `result` matched by `claudeQuotaPatterns`. When all three hold the result is `kind: "quota"` with the full stdout JSON preserved as diagnostics. Other zero-exit envelopes stay non-quota.

Because Claude streams, a null `last_output_age_ms` on a stall means the agent produced no observed output during that window — not that the harness could not see Claude. Before stream-json, batch JSON arrived only at exit and the idle watchdog was structurally blind to a live Claude.

### Observed quota samples (real samples)

Quota signals may appear on stdout or stderr. The verified monthly-spend-limit
sample below is exit-`0` JSON on stdout.

- 2026-06-19 — Claude Code monthly spend limit (exit `0`, stdout JSON envelope)

  ```text
  {"type":"result","subtype":"error","is_error":true,"api_error_status":429,"duration_ms":842,"duration_api_ms":0,"ttft_ms":0,"num_turns":0,"result":"You've hit your monthly spend limit","stop_reason":null,"session_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","total_cost_usd":0,"usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":"","iterations":[],"speed":"standard"},"modelUsage":{},"permission_denials":[],"terminal_reason":"error","fast_mode_state":"off","uuid":"c8d9e0f1-2345-6789-abcd-ef0123456789"}
  ```

  Fixture: `shared/fixtures/claude/2.1.142-monthly-spend-limit.json`.

## Codex

Codex quota detection covers non-zero and zero exits: on zero exit the runner checks combined stderr+stdout against `codexQuotaPatterns` and reclassifies `ok` to `quota` on a match, so a cleanly-exiting quota exhaustion still advances fallback. Zero-exit stderr matching `codexCredentialAuthPatterns` reclassifies to `quota` with `authFailure: true` first.

### Observed credential/auth stderr (real samples)

- 2026-06-25 — Codex refresh token revoked (exit non-zero, stderr)

  ```text
  Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.
  ```

- 2026-08-28 — Codex refresh token expired (exit `0`, stderr)

  ```text
  401 Unauthorized
  Failed to refresh token: … Please log out and sign in again
  ```

- 2026-08-29 — Codex trusted-directory refusal (exit non-zero, stderr)

  ```text
  Not inside a trusted directory and --skip-git-repo-check was not specified.
  ```

### Observed quota stderr (real samples)

- 2026-09-02 (`homestead-service` run `27357953`, shrink step, exit 1): a `codex_core::shell_snapshot` error line precedes the banner — `ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 6th, 2026 9:54 PM.` Classified `error` under the old transient-first order; `quota` now.

## Cursor

Cursor quota detection covers non-zero and zero exits against `cursorQuotaPatterns` the same way as Codex. Cursor has reported a false `quota` at ~24s on a stream disconnect (2026-07-26); a tight duration cluster is a transport blip wearing quota phrasing, and the cost is spend (escalation to the next rung), not correctness.

### Observed quota stderr (real samples)

- No real samples recorded yet.

## Opencode

### Observed quota stderr (real samples)

- No real samples recorded yet.

### Observed transient stderr (real samples)

- No real samples recorded yet. Current `UnknownError`+`500` matching is
  best-effort until a real stderr sample is captured here.

### Observed model-configuration stderr (real samples)

- No real samples recorded yet.

## Pattern audit (`shared/invocation/agents.ts`)

Status key: `Matched` — verified against a real sample in this doc; `Unverified` — retained as a best-effort detector, no real sample yet.

### `claudeQuotaPatterns`

- `/\byou['’]ve hit your (?:session|weekly|opus) limit\b/i` — Unverified.
- `/\byou['’]ve hit your monthly spend limit\b/i` — Matched (2026-06-19, exit-`0` JSON envelope).
- `/\byou['’]ve hit your org['’]s monthly usage limit\b/i` — Unverified.
- `/\bcredit balance is too low\b/i` — Unverified.
- `/\brequest rejected \(429\)\b/i` — Unverified.
- `/\binsufficient[_ ]quota\b/i`, `/\bquota exceeded\b/i`, `/\b(usages?|requests?) (?:have been )?exhausted\b/i` — Unverified.

### `codexCredentialAuthPatterns`

- `/--skip-git-repo-check was not specified/i` — Matched (2026-08-29).
- `/\brefresh token was revoked\b/i`, `/\brefresh token revoked\b/i`, `/\blog out and sign in\b/i` — Matched (2026-06-25).
- `/\bplease log out and sign in\b/i` — Matched (2026-06-25; 2026-08-28 zero-exit stderr).
- `/\bre-?authenticate/i`, `/\bre-?authentication required\b/i` — Unverified best-effort.

### `codexQuotaPatterns`

- `/\byou['’]ve (?:hit|reached) your usage limit\b/i`, `/\busage limit\b.*\b(?:reset|resets|window)\b/i`, `/\brate_limit_exceeded\b/i`, `/\binsufficient[_ ]quota\b/i`, `/\bquota exceeded\b/i` — Unverified.

### `cursorQuotaPatterns`

- `/\bout of usage\b/i`, `/\bincrease your limit\b/i` — **Verified 2026-09-08.** Cursor's live exhaustion banner is `ActionRequiredError: Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.` Two independent anchors are used so a reworded half still classifies; the `ActionRequiredError` class name is deliberately *not* matched, since it also covers non-quota action-required conditions. Before these landed the banner classified `error`, and because the agent order advances on quota only, the chain stopped one rung short of an available agent — eight stages on project `sudoku` failed that way in a day.
- `/\byou['’]ve hit your usage limit\b/i`, `/\byou['’]ve hit your free requests limit\b/i`, `/\btotal usage limit reached\b/i`, `/\bmonthly cursor usage limit\b/i`, `/\bon-demand spending limit\b/i`, `/\bspend limit\b/i`, `/\bresource_exhausted\b/i`, `/\binsufficient[_ ]quota\b/i`, `/\bquota exceeded\b/i` — Unverified.

### `opencodeQuotaPatterns`

- `/\brate limit\b/i`, `/\bquota exceeded\b/i`, `/\binsufficient_quota\b/i`, guarded `429` status lines, `/\byou have exceeded your\b/i` — Unverified.

### `modelConfigurationPatterns`

- `/\bunknown model\b/i`, `/\bunsupported model\b/i`, `/\binvalid model\b/i`, `/\bmodel not found\b/i`, `/\bmodel is not available\b/i`, `/\bnot available for your account\b/i`, `/\bunrecognized model\b/i`, `/\bLLM Provider NOT provided\b/i` — Unverified.
- opencode: `/\bno provider configured for\b/i` — Unverified.

### `transientPatterns`

- `connection closed|reset|refused`, `socket hang up`, `premature close/end`, `stream closed`, `econnreset`, `epipe`, `broken pipe`, `service unavailable`, `overloaded`, guarded `502|503|504|529` status lines — Unverified.
- opencode: guarded `500` status lines with transport context words (including `unknownerror`) — Unverified.

## Follow-up TODOs

- No clearly broken pattern identified from real samples yet; reevaluate as captured samples accumulate.

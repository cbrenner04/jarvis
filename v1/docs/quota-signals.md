# Quota Signals & Transient Errors

Jarvis classifies quota exhaustion and transient transport errors after an agent
CLI exits non-zero. Exit codes are not documented as stable by the vendors, so
the implementation treats the exit code as a guard (`0` is never quota or transient
at the shared spawn layer) and matches stderr text patterns. **Exception:** the
Claude adapter reclassifies a verified exit-`0` JSON error envelope before
accepting `kind: "ok"` (see [Claude](#claude)).

## Transient transport errors

A transient transport error is a momentary network failure (connection reset,
broken pipe, HTTP 502/503/504, etc.) that exits non-zero but is not caused by
quota exhaustion or code failure. The shared spawn layer (`src/agents/spawn.ts`)
detects these via **`isTransientSignal`** (`src/agents/quota.ts`) and retries the
**same** agent on the **same** binding, bounded by a fixed cap of **3 re-attempts
(4 total spawns)** with **escalating backoff ([1s, 2s, 4s]** before re-attempts
1/2/3). If all attempts fail, the final error is returned as **`kind: "error"`**
for normal fallback/termination handling. This recovery happens transparently
before callers see a result — **no mode or binding changes**. `isTransientSignal`
matches the shared transport patterns for every agent plus opencode-only
guarded HTTP 500 stderr phrasing, including current best-effort
`UnknownError`+`500` wording, so opencode server blips ride the same retry loop
without changing git/gh retry classification.

Transient re-attempts do not reset iteration timeouts (idle, per-iteration, or
global); whole-iteration budgets accrue across all attempts. An aborted
invocation (timeout, SIGINT) is not retried; the abort result is returned
immediately. Backoff sleep races the abort signal — an abort arriving during
backoff returns immediately without waiting out the remaining delay. Each
re-attempt fires an optional `onTransientRetry` callback allowing modes to emit
operator-facing diagnostics (see patch harness below).

**Patch mode:** Patch wires `onTransientRetry` to emit `transient transport error
(exit N); retrying same agent (attempt A/CAP)` via harness stderr so operators
can distinguish retry from hang. This phrase shares no substring with quota
strings (`quota exhausted; falling back` / `probable quota-like error`).

### Git/gh chokepoint retry

The harness chokepoint `runGhCommand` (`src/gh.ts`) — used for `gh auth status`,
`gh repo view`, `gh pr comment`, and review-feedback gh calls — implements the
same bounded retry pattern for transient git/gh network errors. The classifier
**`isTransientNetworkError`** (`src/agents/quota.ts`) matches the shared
`sharedTransportPatterns` (agent-spawned errors) ∪ harness-scoped git/gh
phrasings that the agent path does not exercise:

- `TLS handshake timeout` (seed 3 kill signal)
- `could not resolve host` (DNS failure)
- `operation timed out` / `timed out`
- `SSL_ERROR` / `SSL error` / `handshake failure`
- `the remote end hung up unexpectedly` (git over HTTPS)

Bounded retry cap is **2 re-attempts (3 total invocations)**, with a **1-second
backoff** between attempts (network transients benefit from a brief pause; agent
spawn matches with escalating backoff). Sleep is injectable for tests. Permanent
gh failures — not-authenticated, 404, branch-protection `BLOCKED` — do not match
any pattern and fast-fail with exactly one invocation. Each re-attempt emits
`OP: transient network error; retrying (attempt A/CAP)` via an injectable
`onRetry` callback, operator-distinguishable from quota strings and the agent
transient line (not confusable with hang or fallback).

## Credential/auth failures

A credential or auth failure is a durable session/token error (refresh token
revoked, re-authentication required, log out and sign in) that prevents the
agent from running. The shared spawn layer (`src/agents/spawn.ts`) detects
these via **`isCredentialAuthSignal`** (`src/agents/quota.ts`) and classifies
them as **`kind: "quota"`** with an **`authFailure: true` marker**, allowing
the run to rotate to the next agent. Only true durable-auth phrasing is matched;
transient-looking blips (bare `401`/`unauthorized`, or messages matching both
auth and transient signals) fall through to the transient or generic-error paths
and do not rotate (allowing same-agent retries to recover a momentary blip).

Patterns are **scoped per-agent**: Codex has verified auth patterns; Claude and
Cursor patterns are deferred to the first real sample. This rules out false
positives from broad cross-agent matching. When every agent is exhausted by auth
and/or quota, the run terminates via the existing quota-exhaustion path (exit 2).

**Known limitation:** Classification requires a non-zero exit code; an exit-0 CLI
emitting auth-failure stderr (if one exists) would return `kind: "ok"` without
rotating. This is within the stderr-driven, exit-code-unconfirmed scope, but
represents residual risk if a sample exits 0.

## Quota fallback

**Patch and plan modes:** With `quotaFallback: "lenient"`, **`applyQuotaFallbackWhenAllowed`**
(`src/agents/quota.ts`) may upgrade `kind: "error"` using **`applyQuotaFallbackToAgentResult`**
 / **`isWeakQuotaSignal`**. The caller passes **`allowLenientWeakQuotaFallback`**: patch sets it when
an iteration made **no progress** (no new acceptance-criteria checks and no dirty worktree).
Plan sets it when **`git status --porcelain`** is **unchanged** across that agent invocation (snapshot
before and after `agent.run` via `src/modes/plan/git-porcelain.ts`). If the worktree changed, weak
quota fallback is skipped so partial writes are not mistaken for a clean miss. Strict spawn-side
**`kind: "quota"`** still triggers fallback immediately (no guard).

Spawn order **transient → auth → quota → model_config** ([pipeline](agent-cli-failure-pipeline.md)); same doc covers **`agent.run`** callsites and mode guards.

## Classification and fallback outcome matrix

Authoritative outcomes for CLI result classification, fallback behavior, exit
codes after fallback exhaustion, and telemetry semantics.

| Raw CLI outcome | Classified kind | Patch iteration behavior (`jarvis1 run`) | Plan phase behavior (`jarvis1 plan`) | Exit code when all agents exhausted or no fallback remains | Telemetry kind/reason |
| --- | --- | --- | --- | --- | --- |
| Non-zero exit + durable credential/auth signal from stderr patterns | `quota` (with `authFailure: true` marker) | Rotate immediately to next agent | Rotate immediately to next agent | `2` (quota exhausted) | `quota` / `quota-exhausted` |
| Non-zero exit + strict quota signal from stderr patterns | `quota` | Rotate immediately to next agent | Rotate immediately to next agent | `2` (quota exhausted) | `quota` / `quota-exhausted` |
| Non-zero exit + both strict quota and model-configuration signals | `quota` | Rotate immediately to next agent | Rotate immediately to next agent | `2` (quota exhausted) | `quota` / `quota-exhausted` |
| Non-zero exit + weak quota signal (lenient), guard passes (`allowLenientWeakQuotaFallback=true`) | `quota` (upgraded from weak `error`) | Rotate to next agent only when no-progress guard passes | Rotate to next agent only when unchanged-porcelain guard passes | `2` (quota exhausted) | `quota` / `quota-exhausted` |
| Non-zero exit + weak quota signal (lenient), guard fails | `error` (no upgrade) | No quota rotation; treated as hard failure for that iteration | In current behavior, plan inner loop still continues to later agents on hard `error` (see mode difference below) | Patch exits `1` for error when no fallback path applies | `error` / `agent-error` |
| Non-zero exit + model configuration signal | `model_config` | Stop immediately; do not rotate | Rotate to next agent in draft/intent-split inner loops; fatal in review | `3` (model configuration error) when chain ends on `model_config` without `ok` | `model_config` / `model-config` |
| Timeout / interrupt signal from harness or process control | `timeout` / interrupted run state | Stop run (no quota rotation) | Stop run (no quota rotation) | `124` (timeout) or `130` (SIGINT) | `timeout` / `timeout` or interrupted terminal reason |
| Non-zero exit + generic error (no quota/model-config classification) | `error` | Stop run for that iteration path (no quota rotation) | In current behavior, plan inner loop may continue to next agent after hard `error` | `1` (error) | `error` / `agent-error` |
| Zero exit (spawn layer; no adapter reclassification) | `ok` | Continue normal post-iteration completion/progress logic | Continue normal phase progression | `0` (when run/phase completes) | `ok` / completion or progress reason |
| Zero exit + Claude verified stdout JSON quota envelope (`is_error: true`, `api_error_status: 429`, quota message in `result`) | `quota` (adapter reclassification from spawn `ok`) | Rotate immediately to next agent | Rotate immediately to next agent | `2` (quota exhausted) when all agents exhausted or no fallback remains | `quota` / `quota-exhausted` or `quota-fallback` |
| Zero exit + Codex or Cursor quota pattern in combined stderr+stdout | `quota` (adapter reclassification from spawn `ok`) | Rotate immediately to next agent | Rotate immediately to next agent | `2` (quota exhausted) when all agents exhausted or no fallback remains | `quota` / `quota-exhausted` or `quota-fallback` |

Mode-specific note: patch mode runs one selected agent per iteration, while
plan mode executes an inner agent-order loop per phase invocation. **Documented
policy:** the plan inner loop continues to the next agent after a hard `error`
(availability for spec drafting). Patch stops the iteration on hard `error` and
only rotates agents for quota-classified results within that iteration; see
[plan-mode.md § Hard generic errors](./plan-mode.md#5-hard-generic-errors-excluding-quota-and-model-configuration).

### Operator-visible stderr (grep contract)

Patch (`jarvis1 run`) and plan (`jarvis1 plan`) share these substrings when
rotating agents after a quota-classified result. Each rotation event emits one
line, not multiple:

- **Per-agent rotation (plain quota):** `quota exhausted; falling back` (strict spawn-side
  quota) and `probable quota-like error (exit N); falling back` (lenient
  weak-quota upgrade when the no-progress / porcelain guard passes).
- **Per-agent rotation (model configuration):** `model configuration error; falling back`
  on draft and intent-split inner loops when the configured model is rejected for
  that agent but a later agent may succeed. Plan lines use the `plan: <agent>:`
  prefix; intent-split uses `intent: <agent>:`. Non-empty agent stderr follows the
  harness line. Grep rotation with `; falling back`; terminal exhaustion uses
  `intent: model configuration error` or `plan: model configuration error` without
  that suffix.
- **Per-agent rotation (auth failure):** When a quota-classified result carries
  an `authFailure: true` marker, both patch and plan emit `<agent> auth failed;
  re-authenticate and rerun` instead of quota phrasing, naming the agent needing
  re-authentication. This single auth note appears on all modes that emit per-agent
  rotation lines: patch iteration (`src/modes/patch/iteration.ts`), shrink
  (`src/modes/patch/shrink.ts`), review (`src/modes/patch/review.ts`), prompt
  (`src/modes/prompt/run.ts`), and plan (`src/modes/plan/emit-plan-quota-stderr.ts`).
- **Plan prefix:** the same phrases appear after `plan: <agent>:` so mixed logs
  stay mode-tagged.
- **Final exhaustion:** patch prints `all agents quota-exhausted`. Plan prints
  `plan: all agents quota-exhausted` and may add a phase suffix (`during
  refine`, `during naming-only phase`, etc.).

Canonical string constants: `src/quota-harness-messages.ts`. Plan rotation
lines are emitted from `src/modes/plan/emit-plan-quota-stderr.ts`.

**No-progress escalation (patch only):** When an iteration makes no progress, patch mode also advances `agentOrder` before exiting 4. The per-agent advance line is `<agent>: no progress; escalating to next agent` — distinct from quota-fallback phrasing so operators can distinguish the cause. Exit 4 is reached only after the last rung also makes no progress. See [agents.md § agentOrder as an escalation ladder](./agents.md) for full semantics.

**Idle-timeout escalation (patch implementation, review actuator, and shrink):** When the idle-output watchdog fires and at least one later rung remains, the harness advances before any terminal stop. Patch implementation uses `modes.patch.agentOrder`; review actuator and shrink use `subRoleAgentOrder.reviewActuator` (falling back to `agentOrder`). The per-agent advance line is `<agent>: idle timeout; escalating to next agent` (review actuator: `review: <agent>: …`; shrink: `shrink: <agent>: …`). Patch terminal exit `8` with `watchdog-idle-timeout` is returned only after the final implementation rung stalls. Review actuator terminal idle exits `11`. Shrink terminal idle exits `8`. Fix-up iterations do not escalate on idle abort.

### Zero-output detection (patch implementation)

**Harness blindness guard:** When an implementation-phase agent invocation completes and the harness observed **zero stdout and zero stderr bytes**, the patch iteration emits `zero agent output observed from <agent>; check agent binding` on stderr. This signals a harness measurement defect (the agent likely ran but output was not captured) rather than agent idleness or quota exhaustion. The iteration continues with normal fallback logic and telemetry recording; zero-output does not change exit codes or escalation. However, it surfaces in telemetry and the end-of-run summary for operator investigation.

**Telemetry:** Telemetry rows written during a zero-output iteration include `zero_agent_output: true` (omitted if output was observed). Non-zero-output rows never carry this field. **Summary:** The end-of-run summary notes zero-output occurrences per agent: `N iteration(s) under <agent> produced zero observed output (stdout + stderr); check agent binding and environment.` This row appears in the "notes" section, separate from usage aggregates.

**Coverage:** Zero-output is a harness-only measurement — the detector fires regardless of iteration outcome (`ok`, `error`, `quota`, `timeout`). It is not classified as quota or failure (same iteration may be ok or not), so operators read the zero-output flag to distinguish "no output" from "idle" or "quota" in timeout records where `last_output_age_ms: null`. The guard does not fire when the agent process never spawned (missing binary, spawn-layer error); those already carry named error diagnostics.

### Patch telemetry (`~/.jarvis/runs.jsonl`)

Only **`jarvis1 run`** (patch mode) appends JSONL via `writeTelemetry` today.
For quota events, records use **`kind`: `"quota"`** with **`exitReason`**:

| exitReason | When |
| --- | --- |
| `quota-exhausted` | No fallback agents remain (including empty order edge cases). |
| `quota-fallback` | Strict quota on the current agent; at least one later agent remains. |
| `probable-quota-fallback` | Lenient weak-quota upgrade on the current agent; at least one later agent remains. |
| `no-progress-fallback` | No-progress advance: the current agent made no progress and at least one later agent remains. Emitted on a non-terminal `kind: "ok"` row; the telemetry kind is `ok` (not `quota`). |

Timeout records use **`kind`: `"timeout"`** with:

| exitReason | When |
| --- | --- |
| `watchdog-iteration-timeout` | Iteration watchdog timer fired (`iterationTimeoutMs` elapsed). When the agent root pid was known at fire time, Jarvis also logged `[watchdog] …`, SIGTERM→(5s)→SIGKILL'd that process group, and may include `watchdog_pgid` and `watchdog_descendants_alive`. When pid was still unavailable (watchdog fired before `onSpawned`), telemetry still records `last_output_age_ms` but omits `watchdog_pgid` and `watchdog_descendants_alive`, and no `[watchdog]` line is emitted. |
| `watchdog-idle-timeout` | Idle-output watchdog fired with no later rung (patch implementation final rung or fix-up iteration; review actuator final rung; shrink final rung; review debate/plan terminal idle). Terminal `kind: "timeout"` row on patch implementation; review actuator and shrink use `kind: "error"` (review actuator process exit `11`; shrink process exit `8`). When pgid is known, Jarvis logs `[watchdog] idle timeout fired after Nms; …`, kills the process group, and records `watchdog_pgid` and `watchdog_descendants_alive`; when pgid is unavailable, telemetry includes stall fields only. **Not classified as quota.** |
| `watchdog-idle-timeout-fallback` | Idle advance: the current agent stalled and at least one later agent remains (patch implementation, review actuator, or shrink). Non-terminal per-rung row despite `kind: "timeout"` (same class as `no-progress-fallback`). |
| `iteration-timeout` | Iteration timeout result was returned without watchdog-fire context. |
| `run-timeout` | Global run timeout fired. |

Watchdog-triggered timeout rows may include `watchdog_pgid` so investigations
can tie the timeout to the exact killed process group. They may also include
`last_output_age_ms` (ms since last stdout/stderr chunk at watchdog fire; `null`
when no output arrived) and `watchdog_descendants_alive` (whether ≥1 descendant
of the agent root pid was live at snapshot; omitted when pgid was unavailable).

**Zero-output detection:** Implementation-phase iterations that observed zero stdout/stderr include `zero_agent_output: true` on all telemetry records written during that iteration (invocation + terminal rows). This field is omitted (not `false`) when output was observed. The harness emits a distinct `zero agent output observed from <agent>; check agent binding` line on stderr when this condition occurs, distinct from timeout/idle diagnostics.

Plan phases do not emit matching JSONL rows for per-phase agent outcomes.

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
5. Update the `Pattern audit` section by changing the related pattern status
   from `Unverified` to `Matched` and linking the sample date.

Doc-only workflow is intentional: low friction beats extra tooling here.

## Claude

Claude runs with `--output-format stream-json --verbose`. On exit `0`, the shared
spawn layer returns `kind: "ok"` with raw stdout. The Claude adapter then checks
for a verified quota error envelope before parsing success fields: `is_error: true`,
`api_error_status: 429`, and a quota message in `result` (matched by
`isClaudeQuotaMessageText` / `claudeQuotaPatterns`). When all three hold, the
adapter returns `kind: "quota"` and preserves the full stdout JSON in `stderr`
diagnostics. Other zero-exit envelopes (successful JSON or structured errors
missing any predicate) stay non-quota. Classification is adapter-boundary only;
patch/plan/prompt modes rotate through the existing quota fallback path with no
mode-specific exception. Sources: `src/agents/claude.ts`, `src/agents/claude-json.ts`.

For timeout telemetry, `last_output_age_ms: null` on a Claude patch run now means
the agent produced no observed stdout/stderr during that iteration — not that the
harness could not see Claude output. Before stream-json, Claude's batch JSON
arrived only at exit, so the idle watchdog was structurally blind to Claude even
when the agent was active.

### Observed quota samples (real samples)

Quota signals may appear on stdout or stderr. The verified monthly-spend-limit
sample below is exit-`0` JSON on stdout.

- 2026-06-19 — Claude Code monthly spend limit (exit `0`, stdout JSON envelope)

  ```text
  {"type":"result","subtype":"error","is_error":true,"api_error_status":429,"duration_ms":842,"duration_api_ms":0,"ttft_ms":0,"num_turns":0,"result":"You've hit your monthly spend limit","stop_reason":null,"session_id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","total_cost_usd":0,"usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":"","iterations":[],"speed":"standard"},"modelUsage":{},"permission_denials":[],"terminal_reason":"error","fast_mode_state":"off","uuid":"c8d9e0f1-2345-6789-abcd-ef0123456789"}
  ```

  Fixture: `test/fixtures/claude/2.1.142-monthly-spend-limit.json`.

## Codex

Codex quota detection now covers both non-zero exits and zero exits. On zero exit, the spawn layer checks combined stderr+stdout against the committed `codexQuotaPatterns` list; when a pattern matches, the result is reclassified from `ok` to `quota` before returning to the binding caller. This mirrors non-zero exit detection and allows fallback to advance when a quota exhaustion exits cleanly. Non-zero exit detection and credential/auth patterns are unchanged.

### Observed credential/auth stderr (real samples)

- 2026-06-25 — Codex refresh token revoked (exit non-zero, stderr)

  ```text
  Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.
  ```

### Observed quota stderr (real samples)

- No real samples recorded yet.

## Cursor

Cursor quota detection now covers both non-zero exits and zero exits. On zero exit, the spawn layer checks combined stderr+stdout against the committed `cursorQuotaPatterns` list; when a pattern matches, the result is reclassified from `ok` to `quota` before returning to the binding caller. This mirrors non-zero exit detection and allows fallback to advance when a quota exhaustion exits cleanly.

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

## Pattern audit (`src/agents/quota.ts`)

Status key:
- `Matched`: verified against a real sample captured in this doc.
- `Unverified`: no real sample captured yet; pattern retained as a best-effort
  detector.

### `claudeQuotaPatterns`

- `/\\byou['’]ve hit your (?:session|weekly|opus) limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\byou['’]ve hit your monthly spend limit\\b/i` — Matched.
  Sample link: 2026-06-19 (exit-`0` JSON envelope; see Claude section).
- `/\\byou['’]ve hit your org['’]s monthly usage limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bcredit balance is too low\\b/i` — Unverified.
  Sample link: none yet.
- `/\\brequest rejected \\(429\\)\\b/i` — Unverified.
  Sample link: none yet.

### `codexCredentialAuthPatterns`

- `/\\brefresh token was revoked\\b/i` — Matched.
  Sample link: 2026-06-25 (refresh token revoked).
- `/\\brefresh token revoked\\b/i` — Matched.
  Sample link: 2026-06-25 (refresh token revoked).
- `/\\blog out and sign in\\b/i` — Matched.
  Sample link: 2026-06-25 (refresh token revoked).
- `/\\bplease log out and sign in\\b/i` — Matched.
  Sample link: 2026-06-25 (refresh token revoked).
- `/\\bre-?authenticate/i` — Unverified best-effort.
  Sample link: none yet.
- `/\\bre-?authentication required\\b/i` — Unverified best-effort.
  Sample link: none yet.

### `codexQuotaPatterns`

Non-zero exit and zero-exit quota detection.

- `/\\byou[‘’]ve (?:hit|reached) your usage limit\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\busage limit\\b.*\\b(?:reset|resets|window)\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\brate_limit_exceeded\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\binsufficient[_ ]quota\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\bquota exceeded\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.

### `cursorQuotaPatterns`

Non-zero exit and zero-exit quota detection.

- `/\\byou[‘’]ve hit your usage limit\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\byou[‘’]ve hit your free requests limit\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\btotal usage limit reached\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\bmonthly cursor usage limit\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\bon-demand spending limit\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\bspend limit\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\bresource_exhausted\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\binsufficient[_ ]quota\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.
- `/\\bquota exceeded\\b/i` — Unverified (zero-exit path).
  Sample link: none yet.

### `opencodeQuotaPatterns`

- `/\\brate limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bquota exceeded\\b/i` — Unverified.
  Sample link: none yet.
- `/\\binsufficient_quota\\b/i` — Unverified.
  Sample link: none yet.
- `/(?:^|\\n)[^\\n]*(?:error|err|failed|failure|http|status)[^\\n]*\\b429\\b/i`
  — Unverified. Sample link: none yet.
- `/(?:^|\\n)[^\\n]*\\b429\\b[^\\n]*(?:error|err|failed|failure|http|status)\\b/i`
  — Unverified. Sample link: none yet.
- `/\\byou have exceeded your\\b/i` — Unverified.
  Sample link: none yet.

### `modelConfigurationPatterns`

- `/\\bunknown model\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bunsupported model\\b/i` — Unverified.
  Sample link: none yet.
- `/\\binvalid model\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bmodel not found\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bmodel is not available\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bnot available for your account\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bunrecognized model\\b/i` — Unverified.
  Sample link: none yet.

### `opencodeModelConfigurationPatterns`

- `/\\bno provider configured for\\b/i` — Unverified.
  Sample link: none yet.

### `weakQuotaPatterns` (`quotaFallback: "lenient"`)

- `/\\b429\\b/i` — Unverified.
  Sample link: none yet.
- `/\\b503\\b/i` — Unverified.
  Sample link: none yet.
- `/\\brate.?limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\btoo many requests\\b/i` — Unverified.
  Sample link: none yet.

### `weakQuotaExitCodes` (`quotaFallback: "lenient"`)

The `weakQuotaExitCodes` config field (default `[]`) lets operators add
exit codes that should be treated as probable quota when no progress was
made in the iteration. It is intentionally empty by default until real
samples justify a code being added. Populate it via `~/.jarvis/config.json`
when a vendor consistently signals quota with a non-zero exit code that
the strict patterns miss.

### `harnessGitGhTransportPatterns` (git/gh chokepoint retry)

Git/gh-specific transient patterns used by `isTransientNetworkError` and the
bounded-retry `runGhCommand` chokepoint. These are **not** added to the agent
classifier to avoid perturbing agent-spawn behavior as a side effect.

- `/\\bTLS handshake timeout\\b/i` — Matched.
  Sample link: seed 3 (gh auth status failure).
- `/\\bcould not resolve host\\b/i` — Unverified best-effort.
  Sample link: none yet (git DNS failure pattern).
- `/\\boperation timed out\\b/i` — Unverified best-effort.
  Sample link: none yet.
- `/\\btimed out\\b/i` — Unverified best-effort.
  Sample link: none yet.
- `/\\bSSL_ERROR\\b/i` — Unverified best-effort.
  Sample link: none yet.
- `/\\bSSL error\\b/i` — Unverified best-effort.
  Sample link: none yet.
- `/\\bhandshake failure\\b/i` — Unverified best-effort.
  Sample link: none yet.
- `/\\bthe remote end hung up unexpectedly\\b/i` — Unverified best-effort.
  Sample link: none yet (git over HTTPS pattern).

## Follow-up TODOs

- No clearly broken pattern identified from real samples yet; reevaluate once
  captured samples accumulate.

# Shared invocation contract

`shared/invocation/execute.ts` owns the behavior-agnostic, abortable
agent-invocation fallback seam used by v2 write-step execution.

Contract:

- Input: `(prompt, cwd, ordered bindings, AbortSignal?, idleOutputMs?)`.
- Each binding invocation returns typed `ok | quota | stall | model_config | error`.
  `idleOutputMs` is caller-supplied and disabled when unset or `0`; output on either
  stream resets the idle budget.
- Fallback advances when the binding's `shouldAdvance` predicate returns true.
  Default policy is `result.kind === "quota"` only; callers may override per
  binding. Review actuator opts into a broader actuator-only policy (quota,
  lenient weak-quota upgrades, and `aborted: idle-timeout` errors) while
  standalone review debate bindings keep quota-only advance.
- Any non-advancing result stops immediately (no later binding attempt).
  The default policy does not advance on `stall`.
- Output returns ordered attempts plus the final attempt (or `null` when no
  bindings are configured).
- When the caller also passes write-step telemetry context plus a sink, each
  settled binding subprocess appends one `invocation_completed` JSONL row before
  fallback classification continues. An `ok` result carrying `usage`/`cost_usd`
  with source metadata records those exact values on the row; results without
  them or non-`ok` results default to null usage and "unavailable" sources.
  Callers that omit that pair stay telemetry no-op.
- When the caller also passes a `sessionLog` (opened via
  `shared/invocation/session-log.ts`'s `openSessionLog`), every binding attempt
  in the fallback chain writes `harness` (binding id, agent, model) and
  `outbound` (prompt) lines before `binding.invoke` runs, then
  `inbound_stdout`/`inbound_stderr` after it settles: an `ok` result writes
  stdout under `inbound_stdout` and stderr under `inbound_stderr`; a
  `quota`/`stall`/`model_config`/`error` result writes only its `stderr`, under
  `inbound_stderr`. A throwing `sessionLog.append` is swallowed and never fails
  the invocation. Callers that omit `sessionLog` stay unaffected.

Fallback default is quota-only: `model_config` and other `error` kinds are
terminal unless a binding's `shouldAdvance` opts in (review actuator adds
idle-timeout advance on non-final rungs).

Bindings:

- Shared execution consumes an already-flattened ordered binding list. For
  workflow steps, `v2/src/config/agent-model-config.ts`
  `resolveInvocationBindings(...)` flattens executable role + agent + rung
  resolution first, then `shared/invocation/execute.ts` iterates that list.
- `createResolvedAgentBinding({ agentId, adapterModel, priceKey })` in
  `shared/invocation/agents.ts` builds one binding from one resolved rung.
  Resolved `claude` bindings spawn `claude -p --permission-mode acceptEdits
  --model <adapterModel> --output-format stream-json --verbose`, pipe the prompt on stdin,
  parse the terminal `type: "result"` event from the NDJSON stream, unwrap it into display text (plus agent usage/cost when present),
  reclassify verified exit-0 quota envelopes to `quota`, and settle into
  `ok | quota | model_config | error` before fallback continues.
  Resolved `codex` bindings spawn `codex exec --color never --sandbox
  workspace-write -c approval_policy="on-request" --model <adapterModel>`,
  pipe the marker-augmented prompt on stdin, correlate Codex session usage
  best-effort, and settle into `ok | quota | model_config | error` before
  fallback continues. Resolved `cursor` bindings spawn `cursor agent -p
  --output-format stream-json --stream-partial-output --model <resolved-cli-model>
  --force --workspace <cwd> <prompt>`, ignore stdin, parse the stream-json
  NDJSON stream: display text from the terminal `type: "result"` event's `result`
  field (or concatenated `text_delta` frames, or raw stdout when unparseable),
  with token fields mapped from the terminal result's `usage` object when present.
  A stream whose terminal result carries `usage` settles `ok` with
  `usage_source: "agent"`; when the binding's `priceKey` is priced (has at least
  one catalog rate), `cost_source: "computed"` and `cost_usd` is list-price from
  `computeCost` (published rates, not subscription billed spend); when the key is
  unpriced or `loadPrices()` fails, `cost_source: "no-price"` and `cost_usd: null`.
  When `usage` is present but all token fields are null, finalize keeps
  `usage_source: "agent"` and settles `cost_source: "no-usage"` (not `no-price`).
  When usage is absent, `usage_source: "unavailable"`, `cost_usd: null`,
  `cost_source: "no-usage"`, no warning. It settles into `ok | quota |
  model_config | error` before fallback continues. Resolved `opencode` bindings spawn `opencode run
  --dir <cwd> --model <adapterModel> --format json <prompt>` (prompt last),
  ignore stdin, classify quota/model-config/transient with their own opencode
  signals (quota phrasing plus a guarded 429; `no provider configured for` as
  terminal model-config; guarded HTTP 500 with `UnknownError` context as
  transient), and parse the `--format json`
  NDJSON stream: token and cost fields are summed only from clean `step_finish`
  frames (`part.tokens.{input,output,cache.read,cache.write}` and `part.cost`),
  with `text` `part.text` frames supplying display text (raw stdout fallback
  when none). A stream with at least one clean `step_finish` settles `ok` with
  `usage_source: "agent"` and `cost_source: "agent"` (or `no-price` when no
  `part.cost` was numeric); a stream with none settles `ok` with `usage_source:
  "unavailable"`, `cost_usd: null`, `cost_source: "no-usage"`, and a warning. It
  settles into `ok | quota | model_config | error` before fallback continues.
  Other resolved agents still return the terminal
  unwired `error`. Production
  `binding.id` records the resolved rung identity as
  `agentId/adapterModel/priceKey`, so attempts stay distinct even when two rungs
  share the same adapter model string.
- `createAgentBindings(agentIds)` remains the older bare-agent helper for paths
  that still inject prebuilt bindings directly.

## Session log writer

`shared/invocation/session-log.ts`'s `openSessionLog(namespace, timestamp,
opts?)` opens a file-backed, unbuffered writer at
`<sessionsDir>/<namespace>-<timestamp>.log` (sessions dir and clock are
injectable; default sessions dir is `~/.jarvis/sessions/`, default clock is
the system clock), mirroring v1's `<ISO ts> [<tag>] <line>` transcript format
and tag set (`harness`, `outbound`, `inbound_stdout`, `inbound_stderr`).
Multi-line text is split into one stamped line per source line. Appends are
synchronous write-through, so a line is readable from another handle
immediately after `append` returns. Appends after `close()` are dropped
silently; `close()` is idempotent. Open, mkdir, and append failures are
swallowed — the writer degrades to a no-op sink rather than blocking the
invocation it observes. `v2/src/execution/write-loop.ts` is the caller: it
opens a session log per iteration. See `v2/docs/daemon-host.md` for the
write-loop-level contract.

## Terminal `failureKind` (binding-chain stop)

When the step runner classifies `kind: "invocation_failure"` after the binding
chain stops, `failureKind` encodes why:

| `failureKind` | Meaning |
| --- | --- |
| `quota` | Every configured binding returned `quota`; fallback exhausted |
| `stall` | A binding exceeded its caller-supplied idle-output budget |
| `model_config` | First non-quota result was `model_config`; chain stops (no advance) |
| `error` | First non-quota result was `error`; chain stops (no advance) |
| `no_binding` | No bindings configured (`final === null`), including an empty resolved binding list |

Detail (`failureKind` plus ordered `bindingAttempts`) attaches only for
binding-chain `invocation_failure`. Post-invocation token parse failure
(`invalid_token`) maps to loop `kind: "invocation_failure"` but omits these
fields. See [`write-behavior.md`](./write-behavior.md).

Boundary:

- This module owns fallback iteration and ordering.
- It owns write-step `invocation_completed` emission after subprocess settle,
  including one row per binding subprocess across quota fallback, shared logical
  attempt IDs from the caller, and distinct caller-owned `invocation_id` values
  per subprocess row.
- Telemetry sink append failure is surfaced separately on the invocation result
  and does not change fallback behavior or the settled binding result.
- It owns **invocation liveness policy evaluation** (stall vs slow work, profiles by
  behavior × role); workflow loops consume outcomes — [`invocation-liveness.md`](./invocation-liveness.md).
- It does not own token parsing, output-contract checks, workflow loops, CLI
  formatting, or git/worktree side effects.
- Token parsing and contract dispatch are documented in
  [`shared-step-runner.md`](./shared-step-runner.md).

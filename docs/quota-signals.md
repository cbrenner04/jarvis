# Quota Signals

Jarvis classifies quota exhaustion after an agent CLI exits non-zero. Exit codes
are not documented as stable by the vendors, so the implementation treats the
exit code as a guard (`0` is never quota) and matches stderr text patterns.

**Patch and plan modes:** With `quotaFallback: "lenient"`, **`applyQuotaFallbackWhenAllowed`**
(`src/agents/quota.ts`) may upgrade `kind: "error"` using **`applyQuotaFallbackToAgentResult`**
 / **`isWeakQuotaSignal`**. The caller passes **`allowLenientWeakQuotaFallback`**: patch sets it when
an iteration made **no progress** (no new acceptance-criteria checks and no dirty worktree).
Plan sets it when **`git status --porcelain`** is **unchanged** across that agent invocation (snapshot
before and after `agent.run` via `src/modes/plan/git-porcelain.ts`). If the worktree changed, weak
quota fallback is skipped so partial writes are not mistaken for a clean miss. Strict spawn-side
**`kind: "quota"`** still triggers fallback immediately (no guard).

For spawn ordering, harness **`agent.run`** callsites, and mode guards end-to-end, see [Agent CLI failure pipeline](agent-cli-failure-pipeline.md).

## Classification and fallback outcome matrix

Authoritative outcomes for CLI result classification, fallback behavior, exit
codes after fallback exhaustion, and telemetry semantics.

| Raw CLI outcome | Classified kind | Patch iteration behavior (`jarvis run`) | Plan phase behavior (`jarvis plan`) | Exit code when all agents exhausted or no fallback remains | Telemetry kind/reason |
| --- | --- | --- | --- | --- | --- |
| Non-zero exit + strict quota signal from stderr patterns | `quota` | Rotate immediately to next agent | Rotate immediately to next agent | `2` (quota exhausted) | `quota` / `quota-exhausted` |
| Non-zero exit + weak quota signal (lenient), guard passes (`allowLenientWeakQuotaFallback=true`) | `quota` (upgraded from weak `error`) | Rotate to next agent only when no-progress guard passes | Rotate to next agent only when unchanged-porcelain guard passes | `2` (quota exhausted) | `quota` / `quota-exhausted` |
| Non-zero exit + weak quota signal (lenient), guard fails | `error` (no upgrade) | No quota rotation; treated as hard failure for that iteration | In current behavior, plan inner loop still continues to later agents on hard `error` (see mode difference below) | Patch exits `1` for error when no fallback path applies | `error` / `agent-error` |
| Non-zero exit + model configuration signal | `model_config` | Stop immediately; do not rotate | Stop immediately; do not rotate | `3` (model configuration error) | `model_config` / `model-config` |
| Timeout / interrupt signal from harness or process control | `timeout` / interrupted run state | Stop run (no quota rotation) | Stop run (no quota rotation) | `124` (timeout) or `130` (SIGINT) | `timeout` / `timeout` or interrupted terminal reason |
| Non-zero exit + generic error (no quota/model-config classification) | `error` | Stop run for that iteration path (no quota rotation) | In current behavior, plan inner loop may continue to next agent after hard `error` | `1` (error) | `error` / `agent-error` |
| Zero exit | `ok` | Continue normal post-iteration completion/progress logic | Continue normal phase progression | `0` (when run/phase completes) | `ok` / completion or progress reason |

Mode-specific note: patch mode runs one selected agent per iteration, while
plan mode executes an inner agent-order loop per phase invocation. **Documented
policy:** the plan inner loop continues to the next agent after a hard `error`
(availability for spec drafting). Patch stops the iteration on hard `error` and
only rotates agents for quota-classified results within that iteration; see
[plan-mode.md § Hard generic errors](./plan-mode.md#5-hard-generic-errors-excluding-quota-and-model-configuration).

### Operator-visible stderr (grep contract)

Patch (`jarvis run`) and plan (`jarvis plan`) share these substrings when
rotating agents after a quota-classified result:

- **Per-agent rotation:** `quota exhausted; falling back` (strict spawn-side
  quota) and `probable quota-like error (exit N); falling back` (lenient
  weak-quota upgrade when the no-progress / porcelain guard passes).
- **Plan prefix:** the same phrases appear after `plan: <agent>: ` so mixed logs
  stay mode-tagged.
- **Final exhaustion:** patch prints `all agents quota-exhausted`. Plan prints
  `plan: all agents quota-exhausted` and may add a phase suffix (` during
  interview`, ` during naming-only phase`, etc.).

Canonical string constants: `src/quota-harness-messages.ts`. Plan rotation
lines are emitted from `src/modes/plan/emit-plan-quota-stderr.ts`.

### Patch telemetry (`~/.jarvis/runs.jsonl`)

Only **`jarvis run`** (patch mode) appends JSONL via `writeTelemetry` today.
For quota events, records use **`kind`: `"quota"`** with **`exitReason`**:

| exitReason | When |
| --- | --- |
| `quota-exhausted` | No fallback agents remain (including empty order edge cases). |
| `quota-fallback` | Strict quota on the current agent; at least one later agent remains. |
| `probable-quota-fallback` | Lenient weak-quota upgrade on the current agent; at least one later agent remains. |

Plan phases do not emit matching JSONL rows for per-phase agent outcomes.

## Capture convention (real quota events)

Record real quota stderr whenever you hit one during normal usage.

1. Copy the raw stderr text from the failed run. Keep wording and punctuation
   exactly as printed.
2. Redact secrets or personal identifiers only if needed.
3. Add an entry under the matching agent's `Observed quota stderr (real samples)`
   section using this format:

```text
- YYYY-MM-DD — source context (command/repo/provider)

  ```text
  <verbatim stderr block>
  ```
```

4. If the stderr reflects model configuration (not quota), place it in
   `Observed model-configuration stderr (real samples)` instead.
5. Update the `Pattern audit` section by changing the related pattern status
   from `Unverified` to `Matched` and linking the sample date.

Doc-only workflow is intentional: low friction beats extra tooling here.

## Claude

### Observed quota stderr (real samples)

- No real samples recorded yet.

## Codex

### Observed quota stderr (real samples)

- No real samples recorded yet.

## Cursor

### Observed quota stderr (real samples)

- No real samples recorded yet.

## Opencode

### Observed quota stderr (real samples)

- No real samples recorded yet.

### Observed model-configuration stderr (real samples)

- No real samples recorded yet.

## Aider

Initial best-effort substrings for aider are conservative and expected to grow
as real stderr samples are captured.

### Quota substrings (non-zero exit required)

- `rate limit`
- `quota exceeded`
- `insufficient_quota`
- `429` when it appears in an error/status line

### Model-configuration substrings

- `model not found`
- `unknown model`
- `unsupported model`
- `invalid model`
- `could not connect to ollama`
- `connection refused` combined with a model/host hint (for example
  `model`, `host`, `localhost`, `127.0.0.1`, `ollama`, `llama.cpp`,
  `lm studio`)
- `model is not loaded`
- `no such model`

### Observed quota stderr (real samples)

- No real samples recorded yet.

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
- `/\\byou['’]ve hit your org['’]s monthly usage limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bcredit balance is too low\\b/i` — Unverified.
  Sample link: none yet.
- `/\\brequest rejected \\(429\\)\\b/i` — Unverified.
  Sample link: none yet.

### `codexQuotaPatterns`

- `/\\byou['’]ve (?:hit|reached) your usage limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\busage limit\\b.*\\b(?:reset|resets|window)\\b/i` — Unverified.
  Sample link: none yet.
- `/\\brate_limit_exceeded\\b/i` — Unverified.
  Sample link: none yet.

### `cursorQuotaPatterns`

- `/\\byou['’]ve hit your usage limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\byou['’]ve hit your free requests limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\btotal usage limit reached\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bmonthly cursor usage limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bon-demand spending limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bspend limit\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bresource_exhausted\\b/i` — Unverified.
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

### `aiderQuotaPatterns`

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

### `aiderModelConfigurationPatterns`

- `/\\bcould not connect to ollama\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bconnection refused\\b.*\\b(model|host|localhost|127\\.0\\.0\\.1|ollama|llama\\.cpp|lm studio)\\b/i`
  — Unverified. Sample link: none yet.
- `/\\b(model|host|localhost|127\\.0\\.0\\.1|ollama|llama\\.cpp|lm studio)\\b.*\\bconnection refused\\b/i`
  — Unverified. Sample link: none yet.
- `/\\bmodel is not loaded\\b/i` — Unverified.
  Sample link: none yet.
- `/\\bno such model\\b/i` — Unverified.
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

## Follow-up TODOs

- No clearly broken pattern identified from real samples yet; reevaluate once
  captured samples accumulate.

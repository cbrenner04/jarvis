# Quota Signals

Jarvis classifies quota exhaustion after an agent CLI exits non-zero. Exit codes
are not documented as stable by the vendors, so the implementation treats the
exit code as a guard (`0` is never quota) and matches stderr text patterns.

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

## Follow-up TODOs

- No clearly broken pattern identified from real samples yet; reevaluate once
  captured samples accumulate.

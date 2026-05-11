# 03 — Quota signals refinement

## Problem

The opencode quota signals added in
`spec/opencode-as-agent/03-opencode-quota-signals.md` are conservative and
provider-agnostic. With `airproxy` and `copilot` now distinct agents,
jarvis can apply more specific signal sets per agent — for example, a
Copilot "you have exceeded your monthly quota" message should classify as
`quota` even when the substring lookup for the generic `opencode` agent
might miss it.

This subspec refines per-agent signal lists for the two new agents
without disturbing the generic `opencode` list.

## Decisions

- Detection still happens in `src/agents/quota.ts` and is keyed by agent
  name.
- `airproxy`-specific quota signals (case-insensitive substring matches
  in combined output, paired with non-zero exit):
  - All generic `opencode` signals from the prerequisite spec.
  - `"airproxy"` paired with `"limit"` or `"denied"` in the same line.
  - `"403"` and `"forbidden"` co-occurring (some sidecars surface
    upstream auth failures as 403).
- `airproxy`-specific model_config signals:
  - All generic `opencode` model_config signals.
  - `"unknown provider: airproxy"` (defensive: opencode reports this if
    the proxy provider is missing from the user's opencode config).
- `copilot`-specific quota signals:
  - All generic `opencode` signals.
  - `"copilot"` paired with `"limit"` or `"quota"` in the same line.
  - `"you have exceeded your monthly"` (observed Copilot phrasing).
- `copilot`-specific model_config signals:
  - All generic `opencode` model_config signals.
  - `"unknown provider: github-copilot"`.
- These are best-effort; missing signals manifest as `kind: "error"` and
  fallback does not happen for that agent until the substring is added.

## Tasks

- [ ] Extend `src/agents/quota.ts` to include the `airproxy` and
      `copilot` specific substrings on top of the generic `opencode`
      list.
- [ ] Avoid duplicating substring lists; have the per-provider branches
      union the opencode generic list with their additions.
- [ ] Add tests for each new substring under both the quota and
      model_config helpers.
- [ ] Update `docs/quota-signals.md` with `## AirProxy` and `## Copilot`
      sections documenting the substrings.

## Acceptance criteria

- `bun run typecheck`, `bun test`, and `bun run check` pass.
- An `AirProxyAgent` failure with `"AirProxy: rate limit exceeded"` in
  stderr returns `kind: "quota"`.
- A `CopilotAgent` failure with `"You have exceeded your monthly Copilot
  quota"` returns `kind: "quota"`.
- Generic `OpencodeAgent` behavior is unchanged.

## Documentation updates

- `docs/quota-signals.md` — append `## AirProxy` and `## Copilot`
  sections. (Counted as spec-required docs, not part of subspec 04.)

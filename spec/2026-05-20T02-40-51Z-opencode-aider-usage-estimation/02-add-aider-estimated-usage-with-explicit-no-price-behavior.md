# 02 - Add aider estimated usage with explicit no-price behavior

## Problem

`src/agents/aider.ts` currently records successful runs as `usage_source: "unavailable"` and `cost_source: "no-usage"`. That hides usage volume even though jarvis controls the prompt and captures stdout. Aider's occasional stdout token or dollar lines are not stable enough to parse reliably, and most jarvis aider usage targets local models without price-table coverage.

## Decisions

- Aider will use the shared token estimator on successful runs, using prompt and stdout like cursor and opencode.
- `resolveAiderPriceKey` continues to return `null`; this work does not introduce aider price-key mapping.
- Successful aider estimation records `usage_source: "estimated"` and `cost_source: "no-price"` by construction.
- Jarvis does not add a one-time patch-loop notice for normal aider success.
- If estimation fails, aider falls back to the current unavailable/no-usage behavior and adds one warning to the returned `AgentResult`.
- This subspec does not add stdout parsing for aider token or cost lines.
- This subspec must cover both the aider result shape and the downstream no-price enrichment path that follows from `resolveAiderPriceKey` staying `null`.

## Task Checklist

- [ ] Wire the shared estimator into `src/agents/aider.ts`.
- [ ] Preserve aider's no-price posture by leaving `resolveAiderPriceKey` returning `null`.
- [ ] Add regression coverage for aider success and fallback branches plus the downstream no-price behavior this slice relies on.

## Documentation updates

- [ ] Leave operator-facing prose changes for the dedicated documentation subspec, but keep inline code comments accurate anywhere aider usage accounting semantics change.

## Acceptance criteria

- [ ] Successful aider runs estimate tokens from prompt and stdout, attach those counts to the agent result, and return `usage_source: "estimated"`.
- [ ] `resolveAiderPriceKey` still returns `null`, so the change does not imply hosted-model billing support for aider.
- [ ] Downstream usage/cost enrichment records `cost_source: "no-price"` for estimated aider usage because aider still has no price key mapping.
- [ ] No stdout parsing is introduced for aider token or cost lines.
- [ ] If estimation fails, aider still returns a successful agent result with `usage_source: "unavailable"`, `cost_source: "no-usage"`, and exactly one warning explaining the fallback.
- [ ] No new one-time run-loop notice is introduced for normal aider success.
- [ ] Regression coverage proves the aider success path, estimator-failure warning fallback, and the downstream `no-price` outcome introduced by keeping aider price-key resolution disabled.

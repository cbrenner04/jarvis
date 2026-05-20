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

## Task Checklist

- [ ] Wire the shared estimator into `src/agents/aider.ts`.
- [ ] Preserve aider's no-price posture by leaving `resolveAiderPriceKey` returning `null`.
- [ ] Add unit coverage for aider estimated and fallback branches.

## Documentation updates

- [ ] Leave operator-facing prose changes for the dedicated documentation subspec, but keep inline code comments accurate anywhere aider usage accounting semantics change.

## Acceptance criteria

- [ ] Successful aider runs estimate tokens from prompt and stdout and return `usage_source: "estimated"`.
- [ ] Successful aider runs with an estimate report `cost_source: "no-price"` rather than `no-usage`.
- [ ] `resolveAiderPriceKey` still returns `null`, so the change does not imply hosted-model billing support for aider.
- [ ] No stdout parsing is introduced for aider token or cost lines.
- [ ] If estimation fails, aider still returns a successful agent result with `usage_source: "unavailable"`, `cost_source: "no-usage"`, and exactly one warning explaining the fallback.
- [ ] No new one-time run-loop notice is introduced for normal aider success.
- [ ] Unit tests cover successful estimated usage and estimator-failure fallback with warning propagation.

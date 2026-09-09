# Quota signal outranks a transient marker

`settleNonZeroExit` checks `isTransientSignal` before `isQuotaSignal` over the whole diagnostics buffer, so a codex tail carrying both a stray transport line and the usage-limit banner classifies `error`, retries the exhausted agent four times, and settles the step with no fallback (#3372). The stranded-`paused` incident half of the seed stays in `v2/spec/seeds/quota-classification-covers-every-step-role.md`.

- [x] [00 - Classify quota and credential signals before transient ones](./00-quota-before-transient.md)

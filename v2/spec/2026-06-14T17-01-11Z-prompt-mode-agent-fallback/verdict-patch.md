## Verdict

The implementation satisfies the spec’s acceptance criteria: quota fallthrough, exit-2/exit-3 split, hard-error halt, `agents` override seam, integration tests, and required doc updates for fallback policy and telemetry semantics. Three issues remain before merge.

### Required outcomes

1. **Single owner for all-quota terminal exit.** Every all-quota chain already sets exit 2 inside the agent loop (including single-agent chains on the last-agent quota branch). The post-loop `allAttemptedAgentsWereQuota → return 2` branch is unreachable and must be removed. Terminal fallback failure logic must not maintain two competing paths for the same outcome — that invites future drift when the loop changes.

2. **Revert the out-of-scope `gh pr create` env change.** The explicit `env: process.env` on `execFileSync` for PR creation is not in the subspec, inherits by default, and tests pass without it. The diff must not carry unexplained drive-by changes.

3. **Correct lock-busy exit code in `v2/docs/v1-behaviors.md`.** This file was a required doc update. It still documents prompt lock contention as exit 9; `prompt/run.ts` returns exit 1. The behaviors ledger entry must match the implementation (exit 1, not 9) so the doc change does not reinforce a false fact in the same section as the new fallback/telemetry bullets.

### Not required for merge

- Telemetry row assertions, lenient weak-quota tests, single-agent all-quota test, ellipsize regression, `quota-signals.md` prompt column, lenient stderr ordering vs patch, terminal stderr summary for mixed `model_config` exhaustion, duplicated `buildActiveAgents`, or post-success telemetry fallback attribution — all either outside written acceptance criteria, explicitly scoped out by the spec, or pre-existing behavior the subspec did not ask to change.

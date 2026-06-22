# Retry transient failures on the harness's own git/gh network ops

repo: https://github.com/cbrenner04/jarvis

The agent-spawn chokepoint already bounded-retries transient transport errors
(`transient-agent-error-retry`, shipped). The harness's *own* network calls do
not: a complete, reviewed run died because `gh pr ready` hit a TLS handshake
timeout at the finish line. Reuse the shipped classifier + a bounded retry on
the harness's own git/gh calls; keep permanent failures fast-failing.

- [x] [00 - Bounded transient retry inside the gh chokepoint](./00-gh-chokepoint-retry.md)
- [x] [01 - Bounded transient retry on the sync git push / gh pr ready ops](./01-sync-git-gh-retry.md)

Scope is deliberately narrowed to the harness's own network ops: `runGhCommand`,
`pushCurrent`, and the direct `gh pr ready` shell-outs. `git fetch origin`
(`bestEffortFetch`) is excluded by design — it already swallows all failures and
cannot kill a run; other `git` execFileSync sites are local-only.

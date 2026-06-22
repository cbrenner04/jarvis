---
name: harness-transient-retry-git-gh-ops
---

# Retry transient failures on the harness's own git/gh network ops

## Problem

`2026-06-21T04-35-06Z-transient-agent-error-retry` added bounded same-binding retry for the
**agent spawn** chokepoint (transient classifier sibling to quota). But the harness's *own*
network calls — `gh pr ready`, `git push`, other `gh`/`git` ops — have no such retry. This
session a **complete and reviewed** run (flaky-serial-retry, seed 3) died only because
`gh pr ready` hit a **TLS handshake timeout** at the very finish line: the work was done, the
run was thrown away over a transient. Every `gh`/`git` invocation routes through one wrapper
(`runGhCommand`, `v1/src/gh.ts`), so a transient failure anywhere in it kills the run instead of
retrying.

## Direction

Apply the same transient-vs-permanent classifier + bounded retry the agent-spawn path already
uses, at the `runGhCommand` chokepoint (and the git-op equivalent):

- Classify transient network errors (TLS handshake timeout, connection reset, DNS hiccup) and
  retry with bounded backoff before surfacing failure — exactly like the agent transient-retry,
  but for the harness's own calls.
- Keep permanent failures (auth, 404, branch-protection `BLOCKED`) fast-failing — only transient
  network errors retry.

## Out of scope

- The agent-spawn transient retry — already shipped (`transient-agent-error-retry`); reuse its
  classifier, don't reimplement.
- Quota fallback — separate signal, already handled.

## Documentation updates

- `v2/docs/v1-behaviors.md` — harness retries transient failures on its own git/gh ops.

## References

- `v1/src/gh.ts` `runGhCommand` (the gh chokepoint); git push call sites in `v1/src/ready-gate.ts`,
  `v1/src/modes/plan/pr.ts`.
- Reuse the transient classifier from `v2/spec/completed/2026-06-21T04-35-06Z-transient-agent-error-retry`.
- Evidence: seed 3 run died on a `gh pr ready` TLS handshake timeout, complete + reviewed.

## Prerequisites

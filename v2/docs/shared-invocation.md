# Shared invocation contract

`shared/invocation/execute.ts` owns the behavior-agnostic, abortable
agent-invocation fallback seam used by v2 write-step execution.

Contract:

- Input: `(prompt, cwd, ordered bindings, AbortSignal?)`.
- Each binding invocation returns typed `ok | quota | model_config | error`.
- Fallback advances only on `quota`.
- Any non-`quota` result stops immediately (no later binding attempt).
- Output returns ordered attempts plus the final attempt (or `null` when no
  bindings are configured).

Boundary:

- This module owns fallback iteration and ordering.
- It does not own token parsing, output-contract checks, workflow loops, CLI
  formatting, or git/worktree side effects.
- Token parsing and contract dispatch are documented in
  [`shared-step-runner.md`](./shared-step-runner.md).

---
name: write-loop-reprompts-once-for-missing-token
---

# A missing terminal token triggers one cheap re-prompt, not a hard fail

`runStep` returns `invalid_token` when the agent's output carries no terminal token,
and the write loop treats that as terminal on the first miss. The step's work is
already done; only the token is missing.

Before classifying the step, re-prompt the agent once for the token alone — no
re-work, no repeat of the write instructions — and use the token it returns. Only a
second miss is still `invalid_token`. Re-prompt at most once per step, and record the
re-prompt in the run log so operators can see it happened and what the first response
was.

Out of scope: retrying the whole write step; loosening the parser.

## Prerequisites

## Documentation updates

- `v2/docs/write-behavior.md` — the missing-token re-prompt path.
- `v2/docs/shared-step-runner.md` — what happens when token parsing finds nothing.

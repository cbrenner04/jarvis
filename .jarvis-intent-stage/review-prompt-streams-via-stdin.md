---
name: review-prompt-streams-via-stdin
---

# Review invocations stream the prompt via stdin instead of argv

Unsplit rationale: every vendor spawn adapter and the shared `singleSpawn` prompt channel live in one module; claude and codex already pipe stdin there, so cursor (and any same-class adapter) is the same surface with no upstream seam.

## Problem

The review-debate step passes the assembled prompt, including the full lane diff, to the vendor CLI as a command-line argument. On a large diff `posix_spawn` fails with `E2BIG: argument list too long`, the row pauses with `invocation_error`, and the only recovery is re-running implement with `--review-passes 0`, which drops review entirely.

## Decisions

- The invocation layer never places the prompt body in argv; it streams on stdin for every vendor whose CLI accepts prompt input that way (claude `-p` and codex `exec` already do; cursor-agent: plan verifies the stdin form or falls back to a temp file passed by path; opencode only if its CLI supports stdin — otherwise document argv and defer).
- Argv carries only flags and bounded identifiers; update pinned default-argv expectations once, and add a regression test that a multi-megabyte prompt spawns without `E2BIG`.
- No truncation of the diff as a substitute: review quality must not silently degrade on large changes.

## Prerequisites

## Acceptance criteria

- [ ] `agents.test.ts`: cursor binding spawns with a bounded argv (no prompt positional) and pipes a multi-megabyte prompt on stdin without spawn `E2BIG`; fails against current code.
- [ ] `agents.test.ts`: `default and explicit unrestricted policy yield today's argv for claude, codex, and cursor` reflects the new cursor argv shape while claude and codex argv stay byte-identical aside from any shared test harness path.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:agent` pass.

## Documentation updates

- `docs/shared-invocation.md` — cursor (and opencode if changed) prompt delivery matches stdin or documented fallback.
- `docs/v1-behaviors.md` — harness divergence bullet for cursor argv/stdin.
- `docs/operator-runbook.md` — remove the review-debate `E2BIG` gotcha once fixed.

## Primary implementation surface

- `shared/invocation/agents.ts`

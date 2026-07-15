---
name: provision-v2-worktree-dependencies
---

# Provision dependencies before a v2 agent iteration

Fresh git-backed v2 worktrees live outside the project, so Bun cannot resolve
the project's dependencies. The prescribed pre-tick typecheck and tests fail
before the agent can verify its work; the completion gate installs too late.

Provision the worktree at creation so its first agent iteration can run the
prescribed checks without installing dependencies or invoking `bun run ready`.

## Decisions

- Link the project root's `node_modules` into each fresh git-backed external worktree before its callback runs; rules out per-worktree installs and post-agent provisioning.
- Keep dependency setup in the shared external-worktree creation boundary; rules out prompt or `AGENTS.md` instructions that make the agent repair harness setup.
- Keep external worktrees under the Jarvis worktree home; rules out moving them beneath the project only to inherit Bun's directory up-walk.
- Preserve the full ready gate and its repair loop; rules out treating unavailable pre-tick verification as acceptable completion evidence.

## Observable behavior

- A fresh v2 worktree resolves project dependencies before the first agent invocation.
- `bun run typecheck` and the required v2 test commands can run there without agent setup.
- The later full ready gate remains authoritative and can feed a red result into the existing repair loop.

## Out of scope

- v1 worktrees.
- Moving the v2 worktree home.
- Changing prescribed verification commands or ready-gate acceptance.
- Fixing failures reported by a successfully started gate.

## Documentation updates

- `v2/docs/workflow-runner.md` — dependency provisioning at external-worktree creation.
- `v2/docs/operator-runbook.md` — remove the no-dependencies gate-trust gotcha.
- `v2/docs/v1-behaviors.md` — record the changed v2 external-worktree setup behavior.

## Prerequisites

- Git-enabled v2 workflow steps materialize their worktree through the shared external-worktree boundary before agent execution.

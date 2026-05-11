# Permissions

Make non-interactive jarvis runs proceed without permission prompts blocking
them, while keeping a safety floor that prevents destructive or out-of-tree
actions.

## Problem

Jarvis invokes each agent CLI non-interactively (`claude -p`, `codex exec`,
`cursor agent -p`). In that mode, each provider's default permission posture
either prompts (and stalls because there is no TTY) or refuses file writes
outright. The symptom is agent runs that return a "waiting for permission"
message and make no progress.

Each provider already has the knobs needed; jarvis just needs to pass the
right flags at spawn time.

## Approach

Flags only. Jarvis injects a per-provider permission posture when it spawns
the agent. No per-target-repo config files, no jarvis-side abstraction layer
yet — the agent modules in `src/agents/` each add their own flags. Revisit a
unified tool-management layer when a second cross-cutting concern (MCP wiring,
sandboxing knobs, allowed-tool lists) needs the same per-provider translation.

## Default posture

The default posture is "edits in the working tree plus safe shell":

- File edits anywhere under the agent's cwd are auto-allowed.
- Read-only and common filesystem shell commands (`mkdir`, `mv`, `cp`,
  read-only `git`, etc.) are auto-allowed.
- Network egress and destructive shell (`rm -rf /`, `rm -rf ~`, force-push,
  etc.) still prompt or are blocked by the provider's built-in circuit
  breakers.

The posture is fixed: there is no jarvis config knob to relax or tighten it
in this spec. If we need that later, add it as a follow-up.

## Subspecs

- [x] [00 - Default posture definition](./00-default-posture.md)
- [x] [01 - Claude permission flags](./01-claude-flags.md)
- [x] [02 - Codex permission flags](./02-codex-flags.md)
- [x] [03 - Cursor permission flags](./03-cursor-flags.md)
- [x] [04 - Docs and prerequisites](./04-docs.md)

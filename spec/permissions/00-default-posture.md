# 00 - Default posture definition

## Problem

The three providers express permissions differently. Before wiring flags, name
what the shared posture actually means so each provider mapping is checked
against the same target.

## Decisions

- Posture name: `safe-edits`. Used in code comments and docs; not yet a config
  value.
- Capabilities allowed without prompting:
  - File reads and edits under the agent's cwd (the worktree, in spec runs).
  - Read-only shell: `ls`, `cat`, `head`, `tail`, `grep`, `find` (no `-exec`
    / `-delete`), `wc`, `diff`, `stat`, `du`, `cd` within cwd, read-only
    `git` (`status`, `log`, `diff`, `show`, `rev-parse`, `branch --list`).
  - Common filesystem writes: `mkdir`, `touch`, `mv`, `cp`.
  - Project-local build/test commands the agent decides to run as part of the
    spec — these still go through the provider's normal Bash/Shell gate, which
    in `safe-edits` mode prompts. Spec authors who need these auto-allowed
    should request a follow-up to expand the posture.
- Capabilities that must still prompt or be blocked:
  - Network egress (`curl`, `wget`, package installs).
  - Destructive shell aimed at `/`, `$HOME`, or `.git`.
  - Writes outside the agent's cwd.
- The posture is provider-defaults plus targeted relaxations. We do not turn
  on any provider's "bypass everything" mode.

## Tasks

- [ ] Add a short comment block at the top of each `src/agents/<provider>.ts`
      naming the `safe-edits` posture and linking back to this subspec.
- [ ] No code changes here beyond the comments; the flag wiring lives in
      01–03.

## Acceptance criteria

- Each agent module names the posture it implements.
- The posture definition above is the single reference the per-provider
  subspecs cite when justifying flag choices.

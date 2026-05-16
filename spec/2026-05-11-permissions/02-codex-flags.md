# 02 - Codex permission flags

## Problem

`codex exec` defaults to `sandbox_mode = workspace-write` and
`approval_policy = on-request`, which is close to the `safe-edits` posture
but is implicit and can be overridden by a user's `~/.codex/config.toml`.
Spec runs should pin the posture explicitly so jarvis behaves the same on
every machine.

## Decisions

- Pass `--sandbox workspace-write` and `-c approval_policy="on-request"` on
  every `codex exec` invocation.
  - `workspace-write` allows edits inside cwd and blocks writes outside it
    and network egress by default — matches `safe-edits`.
  - `approval_policy="on-request"` lets the model surface a request when it
    needs to leave the sandbox; in non-interactive runs the request becomes a
    refusal in the transcript, which is the behavior we want (no silent
    escalation).
  - Codex CLI 0.130.0 does not accept the older `--ask-for-approval` flag;
    approval policy must be pinned through `-c`.
- Do not pass `--sandbox danger-full-access` or
  `--dangerously-bypass-approvals-and-sandbox`. Ever, from jarvis.
- Do not write a `.codex/config.toml` into the target repo. Codex only loads
  project configs after an explicit trust step, so flags are the reliable
  channel.

## Tasks

- [x] In `src/agents/codex.ts`, append `--sandbox workspace-write` and
      `-c approval_policy="on-request"` to `argv` after the existing
      `--color never`.
- [x] Update the top-of-file comment to mention the permission and sandbox
      flags and link to this subspec.
- [x] Add a test that asserts both flags are present in the spawned argv.

## Acceptance criteria

- A jarvis run using codex against a spec that edits files in the worktree
  succeeds without an approval prompt.
- A codex attempt to `curl` or write outside the worktree surfaces as a
  refusal in the transcript, not a silent success.
- The new test fails if either flag is removed.

# 05 — Log-server requirement

## Problem

`jarvis run` refuses to start without the local log server running, so
that full transcripts are captured to a known place. Plan mode emits the
same kind of long-running agent transcripts (drafting, self-review, and
later interview turns) and benefits from the same guarantee. Plan mode
will require the log server too, with the same preflight check and
error message style.

This subspec lands the preflight check in plan mode. No transcripts are
yet emitted (no agents run), but the check still fires before the stub
exit so reviewers can confirm parity with `jarvis run`.

## Decisions

- **Use the shared mode-entry preflight.** `spec/2026-05-14-cli-modes-and-config-v2/`
  owns the shared log-server preflight call site for agent-running modes.
  This subspec wires plan mode through that helper after target-repo
  resolution; it does not add a plan-only copy of the log-server check.
- **Failure mode.** If the log server is not reachable, plan mode prints
  the same message `jarvis run` prints (e.g. `log server not reachable
  at http://...; start it with \`jarvis log-server\``) and exits `1`.
- **No new flag** to bypass the check. If a user genuinely needs to
  bypass it, they should start the log server. We do not add a
  `--no-log-server` flag in this skeleton.
- **Order of preflights:** parse → resolve repo → log-server check →
  stub exit. Resolution comes first so that "you typed the wrong
  `--repo`" errors surface before the user wonders why the log server
  matters.
- **Skeleton end state.** After this subspec lands, `jarvis plan` with
  a valid invocation, a resolvable repo, and a running log server exits
  `2` with the stub message. With the log server down, it exits `1`
  with the log-server message. With repo resolution failing, it exits
  `1` with the resolution message. With bad args, it exits `1` with the
  arg error.

## Implementation hints

- Use the same shared entry helper referenced in
  `03-target-repo-resolution.md`; the helper should already run the
  log-server preflight after resolution.

## Tasks

- [ ] Wire `planCommand` through the shared mode-entry helper so the
  log-server preflight runs after repo resolution.
- [ ] Ensure plan mode has no duplicate log-server preflight implementation.
- [ ] Tests:
  - Log server down → exits `1` with the existing message text.
  - Log server up + valid repo + valid args → exits `2` with the stub
    message.
  - Log server up + invalid repo → exits `1` with the resolution
    message (resolution runs first).
  - Log server up + bad args → exits `1` with the arg error (parsing
    runs first).

## Acceptance criteria

- [x] Plan mode refuses to start when the log server is not reachable,
  using the same message `jarvis run` uses, exit `1`.
- [x] Plan mode runs the preflight in the documented order (parse →
  resolve repo → log-server → stub).
- [x] No worktree, file, branch, commit, or PR is created or modified
  by any invocation.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 06 covers README and docs.

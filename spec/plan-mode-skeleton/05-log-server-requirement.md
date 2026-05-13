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

- **Reuse the existing preflight.** Whatever helper `jarvis run` uses to
  verify the log server (probably a TCP/HTTP probe against
  `logServerUrl`) is invoked from `planCommand` after repo resolution
  and before the stub exit.
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

- If the existing log-server preflight is inlined inside
  `runCommand`, lift it into a small helper module that both commands
  import. Avoid duplicating the probe.

## Tasks

- [ ] Wire the log-server preflight into `planCommand` after repo
  resolution.
- [ ] If a helper extraction is needed, do it without changing the
  observable behavior of `jarvis run`.
- [ ] Tests:
  - Log server down → exits `1` with the existing message text.
  - Log server up + valid repo + valid args → exits `2` with the stub
    message.
  - Log server up + invalid repo → exits `1` with the resolution
    message (resolution runs first).
  - Log server up + bad args → exits `1` with the arg error (parsing
    runs first).

## Acceptance criteria

- [ ] Plan mode refuses to start when the log server is not reachable,
  using the same message `jarvis run` uses, exit `1`.
- [ ] Plan mode runs the preflight in the documented order (parse →
  resolve repo → log-server → stub).
- [ ] No worktree, file, branch, commit, or PR is created or modified
  by any invocation.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 06 covers README and docs.

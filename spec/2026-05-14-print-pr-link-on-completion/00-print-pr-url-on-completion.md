# 00 - Print PR URL on completion

## Problem

When `jarvis run` detects a complete spec it emits a single `spec complete`
line via `logging.fanout("harness", "spec complete\n", "stdout")` in
`tryFinishSpecIfDone` (`src/modes/patch/run.ts:1163-1184`) and exits 0. The
operator then has to run `gh pr view` (or open the log server / session log
and scroll) to find the draft PR jarvis just transitioned to ready for
review.

The PR URL is already known to GitHub at this point — `ensureDraftPr`
created it earlier in the run and `maybeMarkReady` flipped it to ready —
but jarvis never captures or surfaces the URL. `createDraftPr` in
`src/pr.ts:60-94` only requests `number,state` from `gh pr view` and the
caller in `src/modes/patch/run.ts:884-901` discards even the number.

## Behavior

- On successful spec completion, the run terminal must print the PR URL on
  its own line immediately after (or as part of) the `spec complete` output,
  before `runIteration` returns exit 0.
- The URL must also be written to the session log and forwarded to the log
  server, matching the existing `spec complete` line's destinations
  (`logging.fanout("harness", ..., "stdout")`).
- When no PR exists at completion time (e.g. the spec had zero unchecked
  boxes on the first iteration so jarvis never made a subspec commit and
  never opened a PR), the harness must still emit `spec complete` and exit
  0. It must not invent a URL or fail. A short explanatory line such as
  `no PR opened (no subspec commits)` is acceptable; silence is also
  acceptable.
- When the URL lookup fails (network error, `gh` not authenticated, PR
  deleted out from under the run, etc.), the harness must still emit
  `spec complete` and exit 0, and must emit a `harness` warning describing
  the lookup failure. The completion path must never regress to a non-zero
  exit because of a URL lookup failure.
- Existing exit codes, completion semantics, draft-PR creation, and ready
  transitions are unchanged. This spec only adds output; it does not change
  PR lifecycle.

## Implementation notes

These are guidance, not contract. The implementing agent may pick a
different shape as long as the behavior above holds.

- Either thread the URL through `ensureDraftPr` (extend its return shape to
  `{ number, url, created }` by adding `url` to the `gh pr view --json`
  selection in `createDraftPr`) and stash the latest known URL on the run
  state, or look it up on demand inside `tryFinishSpecIfDone` via
  `gh pr view <branch> --json url -q .url` against the worktree branch.
- The on-demand lookup is simpler and avoids changing `ensureDraftPr`'s
  return type, at the cost of one extra `gh` call per successful completion
  (acceptable — completion happens once per run).
- Use the same `logging.fanout("harness", ..., "stdout")` channel the
  existing `spec complete` line uses, so the URL lands in the run terminal,
  the session log, and the log server in one shot.

## Tasks

- [ ] Capture or look up the PR URL inside the successful-completion path
  in `src/modes/patch/run.ts` (`tryFinishSpecIfDone`).
- [ ] Print the URL via `logging.fanout("harness", ..., "stdout")` so it
  appears in the run terminal, the session log, and the log server.
- [ ] Handle the no-PR and lookup-failure cases without changing the exit
  code.
- [ ] Add or update tests covering:
  - successful completion with a known PR prints the URL on stdout and
    persists it in the session log
  - successful completion with no PR (no subspec commits) does not error
    and still exits 0
  - successful completion when the URL lookup fails still exits 0 and
    emits a `harness` warning
- [ ] Update `docs/run-loop.md` (output destinations / completion section)
  to document the PR URL line.

## Acceptance criteria

- [x] On successful completion with a draft PR open, `jarvis run` prints
  the PR URL to the run terminal and the session log/server.
- [x] On successful completion with no PR opened, `jarvis run` still exits
  0 with the existing `spec complete` line and does not error.
- [x] On successful completion when the URL lookup fails, `jarvis run`
  still exits 0 with the existing `spec complete` line and emits a
  `harness` warning naming the lookup failure.
- [x] Existing completion, exit-code, draft-PR-creation, and ready
  transition behavior is unchanged.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.
- [x] `bun run check` passes.

## Documentation updates

- [x] `docs/run-loop.md`: document the PR URL line emitted on successful
  completion and note the no-PR / lookup-failure fallbacks.

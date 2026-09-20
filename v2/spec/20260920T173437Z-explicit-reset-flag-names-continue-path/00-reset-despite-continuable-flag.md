# `--reset-despite-continuable` forces retirement on a continuable implement lane

Today a clean, unowned, base-descended implement lane with commits ahead of base always continues on its worktree; the operator cannot ask for a reset without hand-retiring the lane via `jarvis cleanup --abandon`. Add an explicit flag that skips continuation and routes the lane through the ordinary retirement path, with every existing reset gate still applied — so a lane carrying unlanded non-staging commits refuses instead of discarding them (staging-only commits are discarded by design, as today).

## Decisions

- Flag name `--reset-despite-continuable` on `jarvis run workflow implement`, parsed as `resetDespiteContinuable` — rules out a verb-phrased name like `--no-continue`, which would not read as a sibling of the existing `--reset-despite-dirty` / `--reset-despite-landed-criteria` overrides.
- The flag skips only the continuation evaluation; it reuses the existing no-verdict fall-through into `applyPreContinuationGates` rather than a new gate path — rules out bypassing gates, which would silently destroy unlanded non-staging work.
- The unreachable-worktree-`HEAD` check runs ahead of the flag's skip of continuation, so a detached lane gets the unreachable-`HEAD` refusal, not the unlanded-commits one — rules out inserting the skip before that check.
- `resetDespiteContinuable` is an optional field on the existing reset-flag payload; pipeline call sites stay unedited.
- Implement only: no `plan`, `intent`, or `pipeline resume`/`recover` surface in this spec — rules out fanning the flag across every stale-reset caller before a caller needs it.

## Acceptance criteria

- [ ] A test drives `jarvis run workflow implement` with `--reset-despite-continuable` against a clean, base-descended lane with unlanded non-staging commits ahead of base and asserts it refuses with the unlanded-commits reason instead of continuing; it fails against the pre-fix CLI, which rejects the unknown flag.
- [ ] A test drives the same flag against a clean, base-descended lane whose commits carry only staging paths and asserts `resetStaleWorkspace` returns `status: "reset"`; it fails against the pre-fix CLI.
- [ ] A test drives the flag against a lane whose worktree `HEAD` the branch cannot reach and asserts the unreachable-`HEAD` refusal, not the unlanded-commits one.
- [ ] The existing continuation test that drives `resetStaleWorkspace` to `continue` on a clean, base-descended lane with commits ahead stays green without the flag.
- [ ] `--reset-despite-continuable` appears in `jarvis run workflow implement` usage and `--help` flag listing.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — the flag forces retirement on an otherwise-continuable lane and passes every reset gate, alongside the existing note that `--reset-despite-landed-criteria` forces retirement.
- `v2/docs/v1-behaviors.md` — record the explicit reset flag on implement re-dispatch.

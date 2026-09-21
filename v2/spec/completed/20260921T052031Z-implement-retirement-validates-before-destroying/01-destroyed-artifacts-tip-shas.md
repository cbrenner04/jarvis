# 01 — Report retired branch tip SHAs in destroyed-artifacts output

When retirement has destroyed artifacts and a later step fails, `formatDestroyedArtifactsSummary` (`v2/src/commands/workflow.ts`) lists deleted branch names but not their tips, so the operator cannot recover the commits.

## Decisions

- Capture tips in `resetStaleWorkspace` immediately before `performAbandonmentSteps` and merge them into the returned `DestroyedArtifacts` (`v2/src/commands/cleanup.ts`, mirrored in `workflow-start-preparation.ts`); resolving after deletion is impossible. `performAbandonmentSteps` itself is untouched so `jarvis cleanup --abandon` is unchanged.
- Local tip: `git rev-parse --verify --quiet refs/heads/<branch>^{commit}`. Remote tip: the local remote-tracking ref `refs/remotes/origin/<branch>^{commit}`, not `ls-remote`, so capture needs no network and may be stale.
- A failed or empty capture omits that SHA and never blocks or fails retirement.
- Full 40-hex SHAs. Format extends the existing lines: `local branch: <name> @ <sha>`; `remote branch: <name>` gains `@ <sha>` only when the remote tip differs from the local tip or no local tip was captured. Equal tips print the SHA once, on the local line.
- A SHA renders only on a branch line that already prints (the branch was actually destroyed); tips of undeleted branches are never shown.
- The formatter and `DestroyedArtifacts` are shared by every CLI `run workflow` start (implement, plan, intent); the changed output is accepted for all. Daemon pipeline stage resets do not render this summary.

## Tasks

- [ ] Capture tip SHAs before retirement and carry them on `DestroyedArtifacts` (both type declarations).
- [ ] Render them in `Retirement destroyed artifacts:`.
- [ ] Tests.
- [ ] Docs.

## Acceptance criteria

- [x] A new test in `v2/src/commands/workflow.test.ts` forces rematerialization to fail after retirement and asserts stderr contains `local branch: <name> @ <local tip sha>`; fails against the pre-fix code.
- [x] A test with a remote-tracking tip differing from the local tip asserts both SHAs print (`remote branch: <name> @ <remote sha>`); a test with equal tips asserts the SHA appears once and the remote line has no ` @ `.
- [x] A test where capture fails (no remote-tracking ref) asserts retirement still completes and the remote line prints without a SHA.
- [x] A test where only the local branch was destroyed (retirement aborted at remote branch deletion) prints no remote SHA.
- [x] A test in `v2/src/commands/workflow.test.ts` on a standalone plan or intent re-dispatch confirms the same SHA rendering.
- [x] Existing `Retirement destroyed artifacts:` tests in `v2/src/commands/workflow.test.ts` and the `jarvis cleanup --abandon` tests in `v2/src/commands/cleanup.test.ts` stay green.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — recovering a retired branch from the printed tip SHA (`git branch <name> <sha>`); extend the `Retirement destroyed artifacts:` description.
- `v2/docs/workflow-runner.md` — destroyed-artifact evidence returned by `prepareWorkflowStart` carries branch tip SHAs.
- `v2/docs/v1-behaviors.md` — destroyed-artifacts output now carries tip SHAs.

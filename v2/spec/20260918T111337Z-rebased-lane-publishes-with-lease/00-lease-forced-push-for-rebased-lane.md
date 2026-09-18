# Lease-forced publication push for a rebased lane

## Problem

`v2/src/execution/completion-publisher.ts` pushes `HEAD:refs/heads/<branch>` without a lease. A lane rebased on re-dispatch (#4014) whose branch was already pushed is rejected non-fast-forward, which `publication-retry.ts` classifies permanent; the run dies at publication with commits only local. A blanket lease-on-non-ancestor would also overwrite a fixup someone else pushed to the open PR after the rebase, which is a distinct case that must fail, not push.

## Decisions

- Inside the `push` retry step, before every push attempt, resolve the remote tip via `git ls-remote origin refs/heads/<branch>`.
- Remote tip absent, or an ancestor of local `HEAD`: push unchanged, no force or lease flag — the ordinary, non-rebased case.
- Remote tip present and not an ancestor of `HEAD`: resolve local `ORIG_HEAD` (`git rev-parse --verify ORIG_HEAD`). `git rebase` sets `ORIG_HEAD` to the branch's pre-rebase tip in this worktree (`v2/src/commands/cleanup.ts`'s `rebaseWorktreeOntoBase`, the only rebase this worktree runs); ordinary commits during implement don't touch it. If `ORIG_HEAD` resolves and the observed remote tip equals it or is an ancestor of it (the lane may have committed locally after its last publish, before the rebase), that tip is this lane's own prior publish rewritten by the rebase: push with `--force-with-lease=refs/heads/<branch>:<observed tip>` — rules out both a blanket `--force` and an admission-time "rebased" flag threaded through the run.
- Any other non-ancestor tip — `ORIG_HEAD` absent, or resolved but the observed tip is neither it nor its ancestor, or the observed tip's ancestry can't be checked (errors, e.g. missing from the local object store) — is foreign: settle a permanent publication failure naming the branch and the foreign SHA, and do not push. Never lease over a tip this lane can't prove it published.
- A lease rejection (remote moved between observation and push) is a permanent failure whose message names the branch, the expected (observed) SHA, and the actual remote SHA re-resolved via a second `ls-remote` after rejection; if that re-resolve itself fails, report actual as unknown rather than throwing a different error. No retry, never escalate to `--force`.

## Task checklist

- [ ] Add remote-tip resolution + `ORIG_HEAD` proof check in the publisher push step, resolved fresh on every attempt.
- [ ] Map a non-ancestor tip not reachable from `ORIG_HEAD` to a permanent foreign-tip publication failure naming branch and SHA, with no push attempted.
- [ ] Map a lease rejection to a permanent publication failure naming branch, expected, and actual (or unknown) SHA.
- [ ] Tests in `v2/src/execution/completion-publisher.test.ts`, including a real bare-remote race for the lease-rejection case (via the publisher's `git` seam or a hook on the test's bare remote — a real `--force-with-lease` against a real bare remote, not a faked rejection).
- [ ] Docs.

## Acceptance criteria

- [ ] A `completion-publisher.test.ts` test proves a rebased lane whose branch was already pushed (remote tip equals local `ORIG_HEAD`, and separately a case where the remote tip is a strict ancestor of `ORIG_HEAD` because the lane committed locally after its last push) publishes with `--force-with-lease` against the observed remote tip and the remote ends at local `HEAD`; it fails against the pre-fix unconditional non-force push.
- [ ] The non-rebased push path (no remote tip, or remote tip an ancestor of `HEAD`) stays covered by the existing plain-push tests: `publishes push with new upstream and creates draft PR` (`v2/src/execution/completion-publisher.test.ts:165`), `pushes HEAD to the target branch namespace despite a same-named remote tag` (`:206`), and `publishes push with existing upstream` (`:359`) all stay green with no force or lease flag added.
- [ ] A `completion-publisher.test.ts` test proves a foreign remote tip (neither `ORIG_HEAD` nor its ancestor) (a commit this lane never had, reachable today by pushing any extra commit to the branch out of band) settles a permanent publication failure naming the branch and that SHA, with no push attempted; it fails against an implementation that leases on any non-ancestor tip, not only against the pre-fix unconditional non-force push.
- [ ] A `completion-publisher.test.ts` test proves a lease rejection — the remote moved between observation and push, raced through a real bare remote — settles a permanent publication failure naming the branch and expected-versus-actual remote SHA, with exactly one push attempt (tip re-resolved but not re-pushed) and no `--force` argument; extends the existing permanent-rejection baseline at `throws on non-fast-forward push rejection` (`v2/src/execution/completion-publisher.test.ts:552`), which already proves a push rejection is never retried.
- [ ] A `completion-publisher.test.ts` test proves that when the post-rejection `ls-remote` re-resolve itself fails, the permanent failure reports the actual SHA as unknown and does not throw a different error.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — lease-forced push for a rebased lane (the `ORIG_HEAD` proof), and both the foreign-tip and lease-rejection failure shapes.
- `v2/docs/operator-runbook.md` — two separate entries: **foreign tip** (someone else pushed to the branch; recognize by the foreign-SHA message; re-running doesn't recover, reconcile the branch by hand) and **lease lost a race** (the remote moved between observation and push; recognize by the expected-vs-actual SHA message; re-running doesn't recover, reconcile the branch by hand).
- `v2/docs/v1-behaviors.md` — publication push behavior for rebased lanes, covering both failure shapes.

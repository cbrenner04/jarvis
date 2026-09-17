---
name: rebased-lane-cannot-publish-on-non-force-push
---

# A continued lane that was rebased cannot publish: the completion push is non-force

## Problem

`redispatch-continues-committed-lane` (#4014) made an incomplete re-dispatch **rebase** a non-descendant lane onto its base instead of refusing it, which rewrites that lane's commit SHAs. Completion publication then pushes with:

```ts
await git(input.worktreePath, ["push", "origin", `HEAD:refs/heads/${input.branch}`]);
```

`v2/src/execution/completion-publisher.ts:136` — no `--force-with-lease`. For a lane whose branch was **already pushed** (the open-PR case the continuation path explicitly supports, and which #4014's own test `run workflow plan rebases and continues a non-descendant lane with an open PR` exercises), that push is a non-fast-forward and is rejected. `publication-retry.ts:45` classifies `non-fast-forward` / `failed to push some refs` as permanent, so it does not retry.

The result is a strictly worse failure shape than the refusal it replaced: before, the operator got an early, actionable `stale reuse refused` before any agent ran. Now the lane rebases, runs a full implement, and dies at publication with a push rejection — the agent cost is already spent, and the commits survive only locally.

No test covers push-after-rebase.

## Evidence

Found by diff review of [#4014](https://github.com/cbrenner04/jarvis/pull/4014) before merge; the rebase path and the non-force push were both read on the branch. Not yet observed live, because the continuation path had not landed at the time — expect the first occurrence on the first continued lane with an open PR.

## Decisions

- The completion push uses `--force-with-lease` against the expected remote tip when, and only when, this run rebased the lane; rules out both a blanket force push and a lane that can never publish after a rebase.
- A lease rejection (the remote moved under the lane) stays a permanent publication failure naming the branch and both SHAs; rules out escalating to `--force` and overwriting a push this run did not make.
- A lane that was not rebased keeps the current non-force push unchanged; rules out widening force semantics to ordinary publication.

## Acceptance criteria

- [ ] A `completion-publisher` test proves a rebased lane whose branch was already pushed publishes successfully, using a lease against the tip the run observed; it fails against the current unconditional non-force push.
- [ ] A test proves a non-rebased lane still pushes without any force flag.
- [ ] A test proves a lease rejection settles a permanent publication failure naming the branch and the expected-versus-actual remote SHA, and does not retry or escalate to `--force`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the publication push is lease-forced for a rebased continued lane, and the rejection shape that produces.
- `v2/docs/operator-runbook.md` — what a lease rejection means and why re-running is not the recovery.

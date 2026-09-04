---
name: abandon-refuses-unlanded-work-with-no-pr
---

# `cleanup --abandon` will destroy a circuit-broken lane's complete work, because unlanded work with no PR looks exactly like debris

## Problem

`jarvis cleanup --abandon <name>` gates on PR ownership: it refuses when multiple open PRs match the branch, and when the single matching PR is ready (non-draft). Both gates protect *published* work. Nothing gates on the case where the branch carries commits that are not on the base branch and there is **no PR at all**.

That is precisely the shape a circuit-broken lane leaves behind. A run that authors complete work and then dies in the settlement tail — `iteration_timeout`, `invocation_error`, a publication strand — commits per turn but never ticks acceptance criteria, never pushes, and never opens a PR. What remains on disk is a worktree with real commits, zero ticked criteria, no PR, and no live run: **indistinguishable from a superseded worktree whose work already merged elsewhere**.

End-of-session cleanup is exactly when an operator sweeps those. The documented close ritual is `jarvis cleanup`, and the natural response to a wall of `Skipped stranded artifact: … another materialized worktree owns this spec` is to abandon the owning worktrees. Doing that in bulk silently destroys any lane in this state, and `--abandon` deletes the local branch and the remote branch, so the commits survive only as unreferenced objects.

## Evidence

Observed 2026-09-04. `20260902T035310Z-retire-jarvis-write-command` had sat on disk since 2026-09-02 after its implement `iteration_timeout`'d twice and the lane was circuit-broken. State: one commit (`7a68c2c9c`) ahead of `main` touching 16 files, **zero** of its 12 acceptance criteria ticked, no PR ever opened, no live run.

Independent review of that commit found subspec 00's code change correct and complete — the consumer sweep clean, `WRITE_USAGE` / `writeStdoutJson` at zero remaining references, and the help-flags parity test correctly repointed off the removed `write` key. Only mechanical work remained (three import-ordering slips, five dead-residue items, and the untouched doc subspec). It was finished by hand in ~20 minutes.

In the same sweep, four sibling worktrees were correctly abandoned after verifying their features present on `main`. The only thing separating the valuable one from the four disposable ones was `git rev-list --count origin/main..<branch>` plus reading the commit — a check the tool does not make and the operator is not prompted to make.

## Decisions

- `--abandon` refuses when the branch has commits not reachable from the repository base branch **and** no PR (open or merged) is associated with it; the refusal names the branch tip SHA, the commit count, and the changed-file count. Rules out treating "no PR" as "nothing published, therefore nothing to lose".
- `--yes` does not bypass this refusal; a distinct explicit override (`--discard-unlanded`) is required. Rules out the scripted-apply path silently destroying work, which is the path a close-out sweep uses.
- The refusal message names the recovery: hand-finish the branch, or re-run `--abandon` with the override. Rules out a refusal the operator cannot act on without reading source.
- Bulk `jarvis cleanup` merged-worktree retirement is unchanged — it already requires a merged PR, so it cannot reach this state. Rules out widening the gate to a path that is already safe.
- A branch whose commits are all reachable from the base branch (the ordinary superseded case) is unaffected and abandons as today. Rules out a gate that makes routine cleanup interactive.

## Acceptance criteria

- [ ] A new cleanup test `abandon refuses a branch with unlanded commits and no PR` builds a worktree whose branch is ahead of base with no PR and asserts `--abandon` refuses without removing the worktree, deleting either branch, or closing anything, naming the tip SHA and commit count; it fails against the pre-fix path that retires it.
- [ ] A new cleanup test `abandon refusal for unlanded work is not bypassed by --yes` asserts `--yes --abandon` hits the same refusal; it fails against a gate wired only to the interactive prompt.
- [ ] A new cleanup test `abandon discards unlanded work under the explicit override` asserts `--discard-unlanded --yes --abandon` completes the ordinary retirement sequence; it fails if the refusal is unconditional.
- [ ] A new cleanup test `abandon retires a branch whose commits are all on base` asserts the superseded case is unaffected; it fails against a gate keyed on PR absence alone rather than on unlanded commits.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § `--abandon`: the unlanded-work refusal, the override flag, and a session-close note that a circuit-broken lane is indistinguishable from debris without checking `git rev-list --count <base>..<branch>`.

Verifying the advocate's claims against the implementation and spec before issuing the verdict.


## Adjudicator verdict — required outcomes

### 1. Workflow and guard-inversion acceptance must match real git porcelain ordering

The new workflow test uses a git worktree but leaves `.jarvis-intent-stage/` **untracked** (`twoFileIntentWorkflow` write step is `role: "plan"` with `git: false`; nothing commits staging before review). The actuator edit is therefore `??`, not unstaged tracked ` M`, so whole-buffer `.trim()` does not affect that scenario.

Even with tracked staging, intent review writes `.jarvis-intent-review-verdict.md` / `.owner` before the boundary check, and those paths sort **before** `.jarvis-intent-stage/…`, so the first porcelain line is not ` M` on the edited staging file. The ticked workflow AC and guard-inversion item (workflow leg goes RED on revert) are not met.

**Required:** Either (a) reshape the workflow fixture so boundary enforcement at review time genuinely depends on correct parsing of a **first-line** unstaged tracked porcelain entry that is allowlist-relevant (e.g. a pre-existing tracked dirty path that lexically precedes the verdict sidecars, with an in-place edit under staging that must still pass), or (b) narrow the written acceptance and guard-inversion scope to what the workflow test actually proves (end-to-end happy path on real git) and rely on the mocked unit test for trim inversion—without leaving ticked criteria that stay green when whole-buffer `.trim()` is restored.

### 2. Outside-staging “unmangled path” coverage must use the git enforcement path

Extending `"restores a reviewed-intent boundary violation in the split workspace"` with `rogue.txt` runs through a **non-git** workspace and the `fs` snapshot branch of `getChangedPaths`, not `gitStatusPaths`.

**Required:** Add or extend coverage where git-enabled `executeReviewCycleEnforced` (or `getChangedPaths` with `before.kind === "git"`) would produce a **wrong** boundary message if porcelain parsing mangles the first ` M` line—assert the failure message contains the full repo-relative path.

### 3. `implement-queue.md` reliability seed must not overclaim the original outage

Removing the seed row asserts the porcelain trim bug caused “seven for seven” intent-review boundary failures. Given verdict sidecar ordering, aggregate trim on staging ` M` as the **first** line is not reachable in the narrative the spec used; git-mode `getChangedPaths` also returns the **full** porcelain set, not a snapshot diff, so other pre-existing dirty tracked paths can still trigger boundary failures independent of this parse fix.

**Required:** Restore or replace that queue entry so operators are not told the known intent-review boundary outage is resolved by this patch alone until a live run (or a test that models the actual failing ordering) confirms it—or clearly separate “parse correctness fixed” from “7/7 reliability seed closed.”

### 4. Keep the parse fix and unit tests

`pathFromPorcelainLine` / no whole-buffer trim / no path-segment trim, the four mocked porcelain tests (including trailing-space and rename), runbook verbatim-path sentence, and existing boundary tests staying green are **sound and should remain**.

---

**Rationale:** Subspec acceptance explicitly requires a git-backed, tracked, in-place staging edit that fails on whole-buffer trim and participates in guard inversion; the current workflow test and queue edit do not satisfy that contract. Documentation and operator queue text must reflect what this change actually fixes versus what still needs a follow-up (e.g. snapshot diff semantics or other dirty paths).
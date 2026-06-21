# Verdict — Refinements Required

The direction, happy path, and committed-path preservation are sound. But the boundary/isolation guarantees — the reason this mode exists — are not actually enforced, and three acceptance criteria are ticked without covering tests. The following must be true before the `[x]` marks stand.

## Required outcomes

1. **Checkout boundary must work under `git: false`.** The spec mandates, explicitly and twice, that the `project.root` checkout-pollution check be detected *without* `git status --porcelain` because that command is unavailable under `git: false`. The current check shells out to `git status` and no-ops when `.git` is absent — so in the exact `git: false` + `commit: false` config this feature targets, the checkout boundary does nothing. Replace the mechanism with one that actually detects splitter writes into the live checkout in a non-git root (e.g. snapshot entries before the split, diff after). The non-git success AC must pass *because* the check ran and found nothing, not because it was inert.

2. **Checkout boundary must not false-positive on a pre-existing dirty tree.** `commit: false` does not imply `git: false`: `project.root` may be a git repo with pre-existing uncommitted changes. The agent runs at `cwd = project.root`, so the boundary must distinguish splitter-created writes from dirt that existed before the split. A baseline-snapshot/diff approach (same fix as #1) satisfies both; a check that flags any pre-existing change is non-conformant.

3. **The external stage-dir rogue-write scan is missing and must be added.** The spec requires a stage-dir-scoped structural scan (rejecting non-`.md` files, subdirectories, and stray entries) as the sibling of the reusable stage-*content* validation — mirroring the committed path, which has both. Only the content validation was implemented; filtering to `.md` silently ignores a `notes.txt`, a subdirectory, or a rogue sibling under the external root. Add the scan so an out-of-bounds write aborts the run, while legitimate siblings under `~/.jarvis/specs/<id>/` (`ready-intents/`, the stage dir, prior plan `*-<slug>/` dirs) do not trip it.

4. **Add the three missing tests named in the spec's Tasks.** No test currently covers: (a) the splitter turn's spawn options carrying `additionalReadDirs` with the external stage dir; (b) a splitter write into the live checkout aborting the run without moving any file into `ready-intents/`; (c) a splitter write outside the external stage dir aborting while legitimate siblings do not trip the scan. These back ACs currently checked `[x]` with no verification. The checkout-pollution test must exercise the real detection path (#1), not a git-status no-op.

5. **Remove the dead `completed` variable in the no-commit branch.** It is set and never read (the cleanup `finally` keys off filesystem state). Cosmetic carryover from the committed path; drop it.

## Explicitly not required

- The start-of-run rm-then-mkdir clear of the external stage dir is **correct and spec-mandated** (the stage is a fixed path surviving a crash). It is not redundant with the per-attempt retry-hygiene clear; they serve different guarantees. Leave it.

## Rationale

Items #1–#3 are load-bearing: the whole point of this mode is to run intent in the isolated `git: false` + `commit: false` setup without polluting the target checkout, and as implemented that guarantee is unenforced in the target config and falsely tripped in an adjacent one — directly contradicting the spec's "detected without `git status`" decision and its two-boundary (checkout + external-root) requirement. #3 closes the stage-content/structural divergence from the committed path. #4 is required because acceptance criteria may not be ticked on untested behavior, especially boundary guarantees that are easy to satisfy vacuously. #5 is minor hygiene.
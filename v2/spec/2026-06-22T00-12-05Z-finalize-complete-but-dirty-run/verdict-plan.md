# Verdict — Required Refinements

The spec's core direction is sound: no auto-ticking, process-liveness correctly rejected as a hang signal, refactor ACs cited as "stays green," v1-behaviors updates present, sequencing correct. None of the below change the direction — they fix scope honesty and pin underspecified behavior. The cluster around subspec 03 and the helper contract is the must-fix.

## 1. Subspec 00 — helper contract must declare its inputs (C1 root cause)

The output-age signal (`lastOutputAtMs`) exists **only** in the patch path; it is plumbed through the patch invocation binding and written on stdout/stderr chunks in the spawn layer. The review, shrink, and plan phases spawn through different bindings with no output-age ref. Subspec 00's helper as drafted implicitly assumes a caller already holds such a ref — true only for patch.

Required: 00 must specify that the extracted helper takes **output-age, file-activity, and the working-directory to scan as explicit inputs supplied by the caller**, not as ambient/assumed constants. This is what makes it actually reusable by phases that lack the patch path's plumbing.

## 2. Subspec 03 — surface the per-phase plumbing as real work; split it (C1, C2, M4, M5)

03 is framed as "arm one calibrated helper in N places," but each target phase (review debate, review actuator, shrink, plan draft/review/verdict-actuator) needs (a) an output-age signal newly plumbed into its own spawn wrapper and (b) idle-abort reconciled with that phase's existing bespoke AbortController/timeout. That is substantial, cross-cutting work spanning unrelated code paths (patch mode vs. plan mode; three distinct invocation bindings), each with new tests.

Required:
- 03's Decisions and Task checklist must name the **per-phase output-activity wiring** as work, not imply free reuse.
- **Split 03** along the patch/plan seam (patch-side: review + shrink; plan-side: the three plan spawns in a separate worktree/binding) per the atomicity and ~1000-line guidance.
- The helper's **working-directory must be a per-phase parameter** — plan phases run in `.worktree/plan-*`, a different tree than the patch worktree (M4).
- Update the index note so 03 (and its split) reads as the heaviest item, not a thin reuse (M5).

## 3. Subspec 01 — name the arming-guard flip (G3)

The watchdog arms off the truthiness/defined-ness of `idleOutputTimeoutMs`. Once 01 defaults it to 600000 it is always set, so the `0`-disables behavior requires changing the arming guard to `> 0`. 01's ACs cover the behavior but the Task checklist never names the guard change. Add it explicitly, and note that every site 03 wires must inherit the same `> 0` guard.

## 4. Subspec 02 — pin the commit→failing-gate ordering with an AC (G4)

After 02, the harness commits **and pushes** the complete-but-dirty worktree *before* the ready gate runs. If the gate then goes stuck-red, unverified code has already been pushed to the PR. The harness cannot know pre-gate that the work is "lint-clean, fully-tested." This is established pattern (the ready gate's own fix-commit already pushes-then-gates, and a red gate leaves the PR draft), so it is likely acceptable — but it is a new-behavior decision the spec must make explicit.

Required: 02 adds a decision stating the commit-then-gate ordering and an AC covering "commit succeeds, gate then fails → PR left draft, exit reflects gate failure, not success."

## 5. Subspec 00 — acknowledge the residual false-kill / false-survive boundaries (G1, G2, G5)

File-activity liveness does not close the gap the spec implies:
- **Silent + no-write work still false-kills** (G1): a long read-only or buffered-output operation (e.g. a big test run with buffered stdout) writes no files and reads as fully idle. #346 was saved only because it *wrote* files. 00 must state this residual class explicitly and lean on the 600000 default as the acknowledged compromise, rather than implying file-activity removes the risk.
- **File-noisy hang never idle-kills** (G2): a hung agent whose child keeps appending to a worktree file shows fresh mtime forever (wall-clock still catches it). State this boundary in one line; soften the intent's "any silent stall" to "any stall with neither output nor file activity."
- **Gitignored writes** (G5): the deferred mtime mechanism may legitimately stay deferred, but the *requirement* must be pinned now — decide whether writes to gitignored paths count as activity. `git status`-based scanning excludes them (false-kills an agent writing to an ignored build/output dir); a raw walk includes them. Pin the requirement, not the mechanism.

## 6. Minor clarity (M1, M2, M3)

- M1: "re-run the completion gate" is imprecise — `countUnchecked` is already 0. Phrase 02 as "fall through past the dirty blocker into the normal completion path."
- M2: 02 should name the existing `completion-ready` label as the reuse candidate for the commit message so the implementer doesn't invent a third label (message must still carry the `Jarvis-Agent` trailer).
- M3: broaden 01's test sweep beyond `run.sandbox-unrunnable.test.ts` to any config-default tests asserting `idleOutputTimeoutMs` unset.

## Rationale

Items 1–2 are the load-bearing fixes: spec guidance requires subspecs be atomic and split at unrelated code paths, and that work not be understated — 03 as drafted hides the bulk of its effort behind a "reuse" framing that the code does not support. Item 4 is a new observable behavior (pushing unverified code) that the intent's "lint-clean, fully-tested" assumption silently glosses; new behavior needs an AC. Items 3, 5, 6 pin underspecified behavior and honest boundaries so the implementer and reviewer share the real contract.
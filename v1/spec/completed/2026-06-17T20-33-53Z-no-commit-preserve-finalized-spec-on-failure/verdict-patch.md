I'll verify the load-bearing claims against the actual code before issuing my verdict, since the dispute centers on test coverage versus ticked acceptance criteria.Now let me verify the key code paths in plan.ts: the boundary path, the write-failure helper, and the breadcrumb helper.Now let me verify the boundary path and the breadcrumb helper, plus the classification path for aider model failures.Confirmed: the boundary path calls `appendBoundaryBlocker` at line 960 (mutating `intent.md`/index) before the breadcrumb at line 997. Now let me verify the aider classification path to confirm the exit-code fragility claim.The model-config patterns include "unknown model", "model not found", "unrecognized model", "no such model" (aider-specific). So if `aider` is installed and emits any of these for `nonexistent-for-test`, classification → `model_config` → exit 3, failing `expect(exitCode).toBe(1)`. The fragility claim is confirmed. The existing sibling tests (lines 49-127) deliberately wrap in `.catch(() => {})` and assert only stdout, avoiding this.

I have verified all load-bearing claims:
- Boundary path mutates intent then breadcrumbs (lines 960, 997) — distinct, order-dependent, untested.
- Review-phase returns (1156+) untested.
- `expect(exitCode).toBe(1)` is environment-fragile (model-config → exit 3 if aider installed).
- AC#4 (`removeAbandonedPreIntentSpecDir`, a local closure at 792) has no test and the spec's EISDIR technique is self-defeating; the spec's sanctioned call-site fallback was not used.
- The breadcrumb fires through one shared helper, so behavioral risk on untested breadcrumb paths is low, but boundary's pre-breadcrumb mutation is separate.

I have enough to issue the verdict.

---

# Verdict — Refinements Required

The implementation's behavior is correct: the helper rename, dead-constant deletion, breadcrumb wiring across all return points, and committed-mode safety (breadcrumb and removal both gated on `externalSpecRoot`, which is set only when `commit === false`) are sound. The problem is **verification debt**: several acceptance criteria are ticked `[x]` without the tests their own labels demand, and one new test asserts an environment-fragile exit code. The spec's acceptance block explicitly states "Both kinds [`(guard)` and `(delta)`] are required" and the Tasks section mandates regression tests covering the criteria. Close the gap below.

## Required outcomes

### 1. Add the missing guard test for review-phase preservation (spec AC: review-phase guard)

The criterion asserting that a `commit: false` review-phase failure preserves the named external spec directory and its `intent.md` is ticked with no test exercising any review-phase return. Add a regression test that drives a review-phase failure and asserts the external directory and `intent.md` survive on disk. If review-phase failure cannot be deterministically induced via the existing bad-agent seam, the criterion must be reworded to reflect what is actually tested rather than left ticked.

### 2. Add the boundary guard test — highest priority (spec AC: boundary guard)

The boundary-violation path is distinct, order-dependent logic: it mutates the on-disk artifact via `appendBoundaryBlocker` **before** emitting the breadcrumb, then preserves the directory. This is the most regression-prone behavior in the change and has zero coverage. Add a test that triggers a `commit: false` boundary violation and asserts both: (a) the external spec directory survives, and (b) its `intent.md` carries the appended `## Blocker`. A future reorder or a short-circuit of the no-commit branch would silently regress this and no test would catch it.

### 3. Make the universal breadcrumb criterion verifiable (spec AC: breadcrumb at every failure)

The criterion requires the preserved-directory line at *every* enumerated `commit: false` failure, but only the draft-generic path is asserted. The breadcrumb flows through one shared helper, so the behavioral risk is modest — but a universally-quantified criterion ticked against one path is under-verified. Add assertions covering at least the quota, model-config, and review breadcrumb paths (the distinct exit codes), or narrow the criterion's wording to match the coverage actually provided. Do not leave a "every failure" claim ticked on single-path evidence.

### 4. Resolve the AC#4 delta rather than skip it (spec AC: pre-`intent.md` write-failure removal)

AC#4 — the single genuinely destructive code change (removing the abandoned directory on pre-`intent.md` write failure) — is ticked with no verification, and the chosen skip is a no-op. The implementer's diagnosis is correct that the spec's suggested `EISDIR` technique is self-defeating (the collision-detection logic relocates the basename so the write succeeds elsewhere). But the spec sanctioned a fallback: "the criterion may instead be satisfied by asserting the single existing call site's behavior." Take that fallback. Because the removal helper is currently a local closure, extract it to module scope (mirroring the already-module-level breadcrumb helper) and unit-test it directly, or otherwise drive the write-failure branch end-to-end. A `(delta)` criterion whose entire point is a destructive operation must not be ticked on inspection alone.

### 5. De-fragilize the draft-guard test's exit-code assertion

The new draft-guard test asserts `expect(exitCode).toBe(1)`. This is environment-dependent: when the `aider` CLI is installed, a nonexistent model name matches the model-configuration signal patterns ("unknown model", "model not found", "unrecognized model"), classifying the failure as model-config and returning **exit 3**, not 1 — failing the test on any machine where `aider` is present. The sibling tests in the same file deliberately avoid this by ignoring the exit code and asserting only output. The test's real subject is directory/`intent.md` survival, not the exact exit code. Replace the strict `=== 1` assertion with `!== 0` (or drop the exit-code assertion entirely) so the test is portable.

### 6. Realign test labels to the spec's acceptance-criteria order

The test labeled "AC#2 (guard): draft phase failure" actually covers the spec's *first* criterion (draft guard), not the second (review guard); the "AC#5" test covers only the draft slice of that criterion. When adding the tests above, name each test case after the criterion it actually verifies so the spec-to-test mapping is unambiguous and the ticked criteria are traceable to evidence.

## Not required

The code's runtime behavior needs no change — the rename, constant deletion, breadcrumb placement, and committed-mode invariant are all correct. The over-coverage of breadcrumbs at the pre-draft and in-draft interrupt paths (beyond the spec's enumerated set) is harmless and exceeds the guarantee; no action needed. The pre-existing orphaned `/** Count subspec files… */` doc comment above `detectGitOrigin` is not introduced by this change and is out of scope. Documentation deltas in `plan-mode.md` and `v1-behaviors.md` correctly extend rather than restate existing prose and are accepted.
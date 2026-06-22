# Verdict — refinements required

The implementation is structurally sound, but several findings are upheld. Address the following.

## 1. Base-ref serial substitution is not fail-safe — fix the behavior, not just the wording (blocking)

The spec claims the `bun run test` → `bun test` substitution "never creates a false-block, at worst fails to recover one." This is **false for `runBaseRefTests`'s polarity.** In that runner, a green base means "failure is pre-existing ⇒ blocker rejected." On a target with no discoverable `*.test.ts` files, serial `bun test` discovers zero tests and exits 0. So a genuinely red base whose parallel run failed would re-run serially, find nothing, exit 0, and **discard a legitimate pre-existing-failure blocker** — a true-red→green flip, the opposite of fail-safe.

Required outcome: the base-ref serial retry must not convert "zero tests executed" into a base-green verdict. Guard it so a serial run that discovered/ran no tests is treated as non-green (blocker stands), preserving the fail-safe direction. The pre-change behavior was fail-safe on non-bun targets; this change must not regress that to fail-unsafe. Correspondingly, narrow the spec's blast-radius claim — it cannot assert "never creates a false-block" for the base-ref runner as written.

(Operating context is bun-on-bun today, so this does not arise in current practice — but the spec asserts a safety property that is false, and the direction flip is a real defect, so it must be guarded or the property honestly retracted.)

## 2. Update the blocker-validation doc entry (required)

Subspec 00's Documentation-updates section explicitly says to note the new behavior "on the blocker-validation entry too." That entry in `v2/docs/v1-behaviors.md` still states the base-ref default treats any non-zero exit as non-green (fail-safe) — now inaccurate, since a non-zero parallel exit first triggers a serial re-run (and, per #1, the result must reflect whatever guard you add). Update that entry so the doc no longer self-contradicts. This pairs with #1: the corrected fail-safe wording lands here.

## 3. Test the three operator signals (required)

AC #4 requires each runner to emit a retry-starting line, a serial-recovered line, and a serial-still-failed line, with the stated rationale of mirroring the gate's operator-visible signal. No test asserts any stderr line, so a refactor dropping a signal stays green. Add at least one assertion per runner covering these signals so the acceptance criterion is actually verified.

## 4. Cover the base-ref non-test-step path through the seam (required)

AC #3 requires that a non-test step failure returns non-green with no serial re-run. The snapshot side proves this (asserts the test invocation count is zero on update-command failure). The base-ref side only tests the merge-base failure, which returns before the command seam is reachable — it proves nothing about the `git worktree add` failure branch, where an erroneous serial re-run would actually be observable. Add coverage asserting the seam is not invoked on that branch.

## 5. Signal/timeout exit classification asymmetry (recommended)

Both runners re-run on a blanket caught error, unlike the gate, which excludes interrupt/timeout exit codes (130/143/124) from triggering a serial retry. The live Ctrl-C hazard is limited here (synchronous `execFileSync` in the foreground process group), so this is lower severity — but it is a real asymmetry with the documented gate contract. Tighten it for parity, or note explicitly why these synchronous runners need not exclude those codes.

## 6. Minor diagnostic asymmetry (optional)

The snapshot runner emits both a new serial-still-failed line and a retained legacy "re-test still failing" line, while base-ref emits one. Harmless (downstream tooling may key on the legacy line), but collapse for symmetry if convenient. Not blocking.

---

No redesign is required. The prompt-governance decisions, fixture regeneration, seam wiring, and behavior-preservation criteria are sound. The seam-driven coverage gap on the real `execFileSync` default path is an accepted consequence of the injectable design and needs no action. Items 1–4 are required; 5–6 are parity polish.
# Session — 2026-06-28 — fix-commit-ready-order rescue

```sh
claude --resume 056c1971-eb19-46eb-add1-db571394ed25
```

## What shipped

Rescued a stalled WIP branch (`2026-06-27T22-03-04Z-jarvis-fix-commit-ready-order-2`, planned as #723 in a prior session) and merged it as **PR #734**. The branch arrived with **31 failing tests** and looked dump-worthy; the spec logic was actually sound — the red was masking two real source bugs plus test-fixture gaps.

| Spec | PR | Agent | Notes |
| --- | --- | --- | --- |
| fix-commit-ready-order (00) | #734 | claude (manual) | reorder full gate to fix → commit → strict ready; hand-implemented, not `jarvis run` |

## The two real bugs (under 31 red tests)

1. **`ready-gate.ts` — `realRunFix` passed no `env` to `execFileSync("bun", ["run","fix"])`.**
   Bun resolves `"bun"` to its own running binary (bypassing `PATH`) when no `env`
   is supplied, so the *real* `bun run fix` ran instead of the test's `PATH` shim.
   The sibling `realBunRunReady` passed `env`, which is exactly why `ready` worked
   but `fix` didn't. One-line fix (`env: { ...process.env }`) turned **27 of 31**
   red tests green.
2. **`completion-pipeline.ts` — the exhausted-retry return dropped `verificationRed`.**
   The new baseline-capture is gated on `verificationRed === true`; the retry
   loop's terminal `return { kind: "red", failureText }` omitted it, so
   `firstRedBaselineSha` was never captured and stuck-red discard never reset to
   baseline.
3. **Test fixtures (`run.test.ts`).** Three real-gate tests had no `bun run fix`
   shim (added `installNoopFixBun`, matching the existing `setupReviewEnv`
   pattern); one was mis-modeled — it exercised the dirty-worktree-completion
   path, not the pre-ready fix-commit path.

Then completed the spec's remaining acceptance criteria: **7 doc files** updated for the new fix → commit → ready order; all **25 ACs** ticked.

## Finalization (manual → jarvis gate)

The spec was hand-implemented, so finalization went through the harness: commit → rebase onto `origin/main` (4 daemon commits, zero v1 overlap, clean) → `triage --mark-ready` (ran the *real* fix → commit → ready gate on the committed tree → green → opened + readied #734) → `triage --merge` (CI green → admin-squash-merge `b97df27a`).

## Harness friction

`triage --mark-ready`/`--merge` first refused with `.active-spec-path marker not found` — production `jarvis run` never writes that marker. Already seeded (`ready-intents/patch-run-writes-active-spec-path-marker.md`, `ready-intents/triage-finalize-without-active-spec-path-marker.md`), so no new seed; worked around by hand-creating the marker. This is the **second** session to hit it (see `2026-06-27T18-36-37Z-operator.md`, red-main spiral cause #3) — worth prioritizing those two intents.

## Cost

No jarvis plan/run spend this session: the plan was a prior session (#723), the implementation was manual, and triage completion gates consume zero agent tokens. Spend is the operator loop (Opus).

### Operator cost

```text
 Total cost:            $22.10
 Total duration (API):  40m 50s
 Total duration (wall): 2h 32m 54s
 Total code changes:    261 lines added, 113 lines removed
 Usage by model:
     claude-haiku-4-5:  569 input, 15 output, 0 cache read, 0 cache write ($0.0006)
      claude-opus-4-8:  20.1k input, 169.9k output, 27.4m cache read, 457.5k cache write ($22.09)
```

The operator loop dominated (the entire session was diagnosis + manual implementation); the high cache-read / output ratio reflects iterative test-failure forensics — three rounds of instrumenting the fake-`bun` shim and the gate before the `execFileSync` env root cause surfaced.

## Stats

- PR #734 merged 2026-06-28T01:58:33Z (squash `b97df27a`).
- 1853 tests pass (was 31 fail); typecheck clean; markdown-lint clean.
- Net change (my work on top of the WIP commit): 11 files, +182 / −118.

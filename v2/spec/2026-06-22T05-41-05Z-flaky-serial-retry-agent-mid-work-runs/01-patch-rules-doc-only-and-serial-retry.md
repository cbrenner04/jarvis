# Patch-rules: doc-only subspecs skip the suite; serial-retry before blocking on a test flake

## Problem

The agent runs `bun run test` directly, mid-work — outside any harness wrapper —
so the gate's serial-retry never applies. Observed: on a docs-only subspec, codex
ran the full suite, hit the parallel-load flaky `watchdog_descendants_alive`
(`v1/test/run.test.ts`), appended a blocker, and stopped (exit 7) before reaching
the gate. Two gaps in `prompts/patch/rules.md` (`patch.rules`):

- A docs-only subspec has no behavior to test, so a full `bun run test` is pure
  flake exposure with zero signal — but the rules tell the agent to run tests
  before ticking.
- For suite runs the agent does make, nothing mirrors the operator/gate recovery
  (re-run serially before believing red), so a single parallel-load flake
  false-blocks the run.

## Decisions

- Add doc-only guidance to `patch.rules`: when the active subspec changes only
  documentation/prose (no code or test behavior), skip `bun run test`; run
  typecheck only if any typed source changed — rules out a blanket "always run
  the suite" that exposes docs-only iterations to flakes for no signal.
- Add serial-retry guidance to `patch.rules`: if `bun run test` fails, re-run
  once as `bun test` (without `--parallel`, no path/filter args) before treating
  the failure as real; only a failure that reproduces serially is real and may
  ground a blocker — rules out blocking on the first parallel-load flake, and
  rules out a retry loop (exactly one serial re-run).
- Keep the serial-retry guidance subordinate to existing stop rules: a
  serially-reproducing failure still follows the current mid-edit-red / blocker
  rules unchanged — rules out the new guidance silencing genuine red.
- Both edits land in the **one** `patch.rules` fragment with a single revision
  bump and one rendered-snapshot regen — rules out two competing revision bumps
  to the same prompt file.
- Bump `patch.rules` and `patch.prompt.body` revisions and regenerate the
  `patch.prompt.body@r<n>` shared + codex-wrapper rendered fixtures per
  `v1/docs/prompt-governance.md` — rules out a content change with a stale
  revision key / stale snapshot.

## Task checklist

- [ ] Add doc-only "skip the suite" guidance to `prompts/patch/rules.md`.
- [ ] Add "serial-retry once before treating a test failure as real" guidance to
      `prompts/patch/rules.md`.
- [ ] Bump `patch.rules` revision; bump `patch.prompt.body` revision.
- [ ] Regenerate `patch.prompt.body@r<n>.shared.txt` and
      `…@r<n>.wrapper.codex.exec.stdin+marker.txt` fixtures.
- [ ] Update the revision assertion in `v1/test/prompts/rendered-snapshots.test.ts`.

## Acceptance criteria

- [ ] `prompts/patch/rules.md` (`patch.rules`) instructs the agent to skip
      `bun run test` on a documentation-only subspec (no code/test behavior
      changed).
- [ ] `prompts/patch/rules.md` instructs the agent, on a `bun run test` failure,
      to re-run once serially (`bun test` without `--parallel`) before treating
      the failure as real or grounding a blocker, and to treat only a
      serially-reproducing failure as real.
- [ ] `patch.rules` and `patch.prompt.body` revision markers are bumped; the
      rendered shared + codex-wrapper fixtures under
      `v1/test/fixtures/prompts/rendered/` are regenerated for the new revision.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` asserts the new
      `patch.prompt.body` revision and stays green; `v1/test/prompt.test.ts`
      (patch prompt contains the rules body) stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: record that serial-retry now applies on three paths
  — the ready gate (existing), harness blocker-validation suite runs (subspec 00),
  and agent guidance via `patch.rules` for mid-work runs — and that `patch.rules`
  tells docs-only subspecs to skip the suite.

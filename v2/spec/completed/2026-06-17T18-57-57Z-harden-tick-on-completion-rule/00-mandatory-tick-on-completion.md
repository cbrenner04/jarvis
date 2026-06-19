# Mandatory tick-on-completion in patch rules

## Problem

Patch rule (`prompts/patch/rules.md:25`) says stop "when you have made
meaningful progress (one or more acceptance criteria ticked) or when the work
is blocked." The failure fires on a narrow case: the active subspec enters the
iteration with acceptance criteria still `- [ ]` whose underlying work is
already complete (prior iteration or operator fix). The agent re-verifies,
reports "already done", and stops without ticking. Progress is gauged by
checkbox transitions (`v1/src/modes/patch/run.ts` no-progress gate, exit `4`),
so with boxes left `- [ ]` the run exits no-progress with correct committed code
and no PR. A subspec already fully `[x]` on entry is unaffected — the
zero-unchecked path completes with exit `0` and a PR.

## Decisions

- Tick-on-completion is a mandatory final step in the rules, not optional. Rules
  out leaving it framed as a stop condition the agent may skip when work is
  already done.
- The step explicitly names the unticked-`[ ]`-but-already-done case
  (re-verify, then tick — never report "already done" and stop). Rules out a
  generic "tick what you satisfied" line that the current wording already
  implies yet lets slip on this case.
- Tick stays restricted to genuinely-satisfied criteria; satisfied bar unchanged.
  Rules out weakening the bar into speculative/optimistic ticking.
- Agent owns the tick; no harness auto-tick. Rules out the harness flipping
  boxes on a clean no-progress exit — it cannot judge criteria content.
- No `run.ts` / no-progress-stop-message change here. Rules out absorbing the
  sibling diagnostic-stop intent; this spec is rules-prose + doc only.
- Regenerate the two rendered-prompt golden fixtures because the inlined rules
  **body text** changes. `prompt.ts` inlines `getById("patch.rules").body`, never
  the fragment revision, so the fixtures go stale solely from the new body
  string. Rules out shipping a stale snapshot via the false belief that a
  revision bump de-stales it.
- Keep the `@r3` fixture filenames and the snapshot test's `revision` assertion
  (`"3"`) unchanged. The `@r3` key derives from the **rendered artifact**
  `patch.prompt.body`, whose revision stays `3`; only the fixture **contents**
  change. Rules out bumping `patch.prompt.body` to chase the key, which would
  break the hardcoded `"3"` assertion and orphan both fixture filenames.
- Bump `patch.rules` `revision` 1 → 2 as honest provenance for editing the
  fragment. Optional — nothing in the test enforces the fragment revision. Rules
  out justifying the bump as the de-stale mechanism (it is not).

## Tasks

- In `prompts/patch/rules.md` under `## Iteration`, make ticking
  confirmed-satisfied acceptance criteria a mandatory final step, covering the
  unticked-`[ ]`-but-already-done path explicitly: re-verify, then tick; never
  report "already done" and stop without ticking. Fold this into the existing
  ticking line (L23) and the "Stop when you have made meaningful progress …"
  line (L25) — replace/rework that region so stopping no longer reads as an
  alternative to ticking already-satisfied work. Do not append a new bullet
  overlapping the existing ticking line; match the file's clipped imperative
  style. Keep the genuinely-satisfied restriction and the existing
  no-speculative-tick rule intact. Leave the index-checkbox sentence (L24,
  "Jarvis flips the index checkbox itself …") unchanged.
- Bump `revision:` 1 → 2 in `prompts/patch/rules.md` frontmatter.
- Regenerate the two rendered fixtures whose inlined rules body changed, keeping
  their `@r3` filenames:
  `v1/test/fixtures/prompts/rendered/patch.prompt.body@r3.shared.txt` and
  `v1/test/fixtures/prompts/rendered/patch.prompt.body@r3.wrapper.codex.exec.stdin+marker.txt`.
  Do not touch the snapshot test's `patch.prompt.body` `revision` assertion
  (`"3"`).
- Add a patch-rules tick-on-completion entry to `v2/docs/v1-behaviors.md`.
- Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [x] `prompts/patch/rules.md` states ticking every confirmed-satisfied
      acceptance criterion as a mandatory final step of an iteration, not an
      optional stop condition.
- [x] `prompts/patch/rules.md` explicitly directs that acceptance criteria left
      `- [ ]` on entry whose work is already complete must be re-verified and
      then ticked, and must not be reported as "already done" and left unticked.
- [x] `prompts/patch/rules.md` still restricts ticking to genuinely-satisfied
      criteria and still forbids speculative ticking.
- [x] `prompts/patch/rules.md` does not instruct the harness to tick acceptance
      criteria; ticking acceptance criteria remains the agent's action. The
      existing sentence that Jarvis flips the `index.md` checkbox itself is left
      intact.
- [x] `prompts/patch/rules.md` frontmatter `revision:` is `2`.
- [x] `bun test` passes, including `v1/test/prompts/rendered-snapshots.test.ts`,
      with the regenerated `patch.prompt.body@r3` shared and codex-wrapper
      fixtures (same filenames) reflecting the new rules body text.
- [x] `v1/src/modes/patch/run.ts` and the `iteration <N> made no progress;
      stopping` message are unchanged by this spec.
- [x] `v2/docs/v1-behaviors.md` records that patch rules require re-verifying and
      ticking already-satisfied acceptance criteria as a mandatory final step,
      with the agent (not the harness) owning the tick.

## Documentation updates

- `v2/docs/v1-behaviors.md`: add a patch-rules behavior entry (no existing
  tick-on-completion entry exists; the nearest entry documents checkbox-driven
  completion *measurement*) to the "Patch mode" cluster under `## Completion,
  blockers, exit codes, and failure handling`. Record the hardened rule:
  re-verify and tick already-satisfied acceptance criteria as a mandatory final
  step; agent owns the tick, harness never auto-ticks. Add a `Sources:` citation
  to `prompts/patch/rules.md`.

## Out of scope

- Changing how completion is measured (still checkbox transitions).
- Changing the no-progress stop path or its message in `v1/src/modes/patch/run.ts`.
- Harness judging acceptance-criteria content/quality or auto-ticking.

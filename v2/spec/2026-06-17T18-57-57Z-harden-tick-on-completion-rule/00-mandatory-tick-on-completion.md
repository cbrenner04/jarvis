# Mandatory tick-on-completion in patch rules

## Problem

Patch rule (`prompts/patch/rules.md:25`) says stop "when you have made
meaningful progress (one or more acceptance criteria ticked) or when the work
is blocked." An iteration that finds the active subspec already satisfied on
entry (prior iteration or operator fix) re-verifies, reports "already done", and
stops without ticking. Progress is gauged by checkbox transitions
(`v1/src/modes/patch/run.ts` no-progress gate, exit `4`), so the run exits
no-progress with correct committed code and no PR.

## Decisions

- Tick-on-completion is a mandatory final step in the rules, not optional. Rules
  out leaving it framed as a stop condition the agent may skip when work is
  already done.
- The step explicitly names the already-satisfied-on-entry case (re-verify, then
  tick — never report "already done" and stop). Rules out a generic "tick what
  you satisfied" line that the current wording already implies yet lets slip.
- Tick stays restricted to genuinely-satisfied criteria; satisfied bar unchanged.
  Rules out weakening the bar into speculative/optimistic ticking.
- Agent owns the tick; no harness auto-tick. Rules out the harness flipping
  boxes on a clean no-progress exit — it cannot judge criteria content.
- No `run.ts` / no-progress-stop-message change here. Rules out absorbing the
  sibling diagnostic-stop intent; this spec is rules-prose + doc only.
- Bump `patch.rules` `revision` and regenerate the rendered-prompt golden
  fixtures that embed the rules body verbatim. Rules out shipping a stale
  snapshot; `v1/test/prompts/rendered-snapshots.test.ts` compares the assembled
  `patch.prompt.body` (which inlines `patch.rules`) against on-disk fixtures.

## Tasks

- In `prompts/patch/rules.md`, make ticking confirmed-satisfied acceptance
  criteria a mandatory final step under `## Iteration`, covering the
  already-satisfied-on-entry path explicitly: re-verify, then tick; never report
  "already done" and stop without ticking. Keep the genuinely-satisfied
  restriction and the existing no-speculative-tick / do-not-edit-`index.md`
  rules intact. Replace the misleading "stop when you have made meaningful
  progress …" framing so stopping no longer reads as an alternative to ticking
  already-satisfied work.
- Bump the `revision:` in `prompts/patch/rules.md` frontmatter.
- Regenerate the two rendered fixtures that embed the patch rules body:
  `v1/test/fixtures/prompts/rendered/patch.prompt.body@r3.shared.txt` and
  `v1/test/fixtures/prompts/rendered/patch.prompt.body@r3.wrapper.codex.exec.stdin+marker.txt`.
- Update `v2/docs/v1-behaviors.md` to record the hardened rule.
- Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [ ] `prompts/patch/rules.md` states ticking every confirmed-satisfied
      acceptance criterion as a mandatory final step of an iteration, not an
      optional stop condition.
- [ ] `prompts/patch/rules.md` explicitly directs that work found already
      satisfied on entry must be re-verified and then ticked, and must not be
      reported as "already done" and left unticked.
- [ ] `prompts/patch/rules.md` still restricts ticking to genuinely-satisfied
      criteria and still forbids speculative ticking and editing `index.md`.
- [ ] `prompts/patch/rules.md` does not instruct the harness to tick; ticking
      remains the agent's action.
- [ ] `prompts/patch/rules.md` frontmatter `revision:` is greater than its prior
      value.
- [ ] `bun test` passes, including `v1/test/prompts/rendered-snapshots.test.ts`,
      with the regenerated `patch.prompt.body@r3` shared and codex-wrapper
      fixtures reflecting the new rules text.
- [ ] `v1/src/modes/patch/run.ts` and the `iteration <N> made no progress;
      stopping` message are unchanged by this spec.
- [ ] `v2/docs/v1-behaviors.md` records that patch rules require re-verifying and
      ticking already-satisfied acceptance criteria as a mandatory final step,
      with the agent (not the harness) owning the tick.

## Documentation updates

- `v2/docs/v1-behaviors.md`: add/extend a patch-rules behavior entry for the
  hardened tick-on-completion rule (re-verify and tick already-satisfied
  criteria; agent owns the tick, harness never auto-ticks), with a `Sources:`
  citation to `prompts/patch/rules.md`.

## Out of scope

- Changing how completion is measured (still checkbox transitions).
- Changing the no-progress stop path or its message in `v1/src/modes/patch/run.ts`.
- Harness judging acceptance-criteria content/quality or auto-ticking.

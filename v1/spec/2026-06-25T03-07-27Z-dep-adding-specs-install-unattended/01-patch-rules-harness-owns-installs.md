# Patch rules: harness owns dependency installs

## Problem

`prompts/patch/rules.md` tells the agent: "New dependency? Record decision in
spec; stop." (line 37). With harness-side install (subspec 00), stopping is
wrong: the agent should edit `package.json`/lockfile and continue, letting the
harness install after the iteration. Worse, an agent that hits the doomed
in-sandbox install can mis-read it as a hard blocker and halt the whole run.
The patch rules must reflect that dependency installs are harness-managed.

## Decisions

- Replace the "stop on new dependency" rule with guidance to edit
  `package.json`/lockfile, record the decision, and continue. — rules out
  leaving the contradictory stop instruction that fights subspec 00.
- State that in-sandbox install failures are expected and harness-managed, so
  the agent must not raise a `## Blocker` solely for a failed dependency
  install. — rules out spurious blockers aborting otherwise-completable runs.
- Bump the `patch.rules` fragment `revision`. — rules out a stale-revision
  fragment under the prompt registry's revision contract.

## Task checklist

- [ ] Rewrite the dependency line in `prompts/patch/rules.md`.
- [ ] Add the harness-owns-installs / no-blocker-on-install-failure guidance.
- [ ] Bump the fragment `revision`.
- [ ] Docs + v1-behaviors update.

## Acceptance criteria

- [ ] The patch rules no longer instruct the agent to stop when adding a
      dependency; they instruct it to edit `package.json`/lockfile, record the
      decision, and continue.
- [ ] The assembled patch prompt (`patch.rules` fragment) states that dependency
      installs are harness-managed and that an in-sandbox install failure is not
      grounds for a `## Blocker`.
- [ ] The `patch.rules` fragment `revision` is greater than its prior value.

## Documentation updates

- `v1/docs/run-loop.md`: note that patch agents add deps and continue (no stop),
  cross-referencing the harness install step from subspec 00.
- `v2/docs/v1-behaviors.md`: record the patch-rules behavior change — agents no
  longer halt on new dependencies and do not block on in-sandbox install
  failures.

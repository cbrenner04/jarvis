# Register the reviewed operator workflow

Expose `intent-reviewed` as the standard v2 intent launcher while retaining explicit split-only `intent`.

## Decisions

- Register `intent-reviewed` as a distinct preset and keep `intent` split-only; rules out silently changing the established preset's behavior.
- Make `--review-passes` valid for `intent-reviewed` and default it to `1`; rules out a separate reviewed builder command or an implicit unbounded loop.
- Describe `intent-reviewed` as the default v2 posture without aliasing bare `intent` to it; rules out breaking explicit split-only parity.

## Tasks

- Register and dispatch the `intent-reviewed` builder through the named workflow launcher.
- Parse `--review-passes` and reject invalid or misplaced usage before daemon contact.
- Extend launcher and end-to-end coverage for both intent presets.

## Acceptance criteria

- [ ] `jarvis run workflow intent-reviewed` accepts the existing seed and target options, defaults to one review pass, and sends one daemon start request after a successful build.
- [ ] `--review-passes N` reaches the reviewed builder, while invalid values and use with split-only `intent` exit nonzero before daemon contact with terse usage guidance.
- [ ] Explicit `jarvis run workflow intent` remains the existing split-only workflow.
- [ ] Launcher coverage proves reviewed success publishes only landed post-review intents and review failure publishes nothing.
- [ ] `v2/docs/workflow-runner.md` distinguishes `intent` from the default-posture `intent-reviewed` launcher and documents `--review-passes`.
- [ ] `v2/docs/first-workflow-walkthrough.md` documents the reviewed operator path, zero-pass escape hatch, outputs, and failure boundary.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with preset registration, CLI selection, and default posture.
- Update `v2/docs/first-workflow-walkthrough.md` with the reviewed intent path.

# Register the reviewed operator workflow

Expose `intent-reviewed` as the standard v2 intent launcher while retaining explicit split-only `intent`.

## Decisions

- Register `intent-reviewed` as a distinct preset and keep `intent` split-only; rules out silently changing the established preset's behavior.
- Make `--review-passes` valid for `intent-reviewed` and default it to `1`; rules out a separate reviewed builder command or an implicit unbounded loop.
- Document `jarvis run workflow intent-reviewed` as the recommended v2 posture without a bare-command alias or implicit launcher default; rules out contradictory operator semantics or breaking explicit split-only parity.

## Tasks

- Register and dispatch the `intent-reviewed` builder through the named workflow launcher.
- Parse `--review-passes` and reject invalid or misplaced usage before daemon contact.
- Extend launcher and end-to-end coverage for both intent presets.

## Acceptance criteria

- [x] `jarvis run workflow intent-reviewed` accepts the existing seed and target options, defaults to one review pass, and sends one daemon start request after a successful build.
- [x] `--review-passes N` reaches the reviewed builder, while invalid values and use with split-only `intent` exit nonzero before daemon contact with terse usage guidance.
- [x] Explicit `jarvis run workflow intent` remains the existing split-only workflow.
- [x] Launcher coverage proves reviewed success publishes only landed post-review intents and review failure publishes nothing.
- [x] `v2/docs/workflow-runner.md` distinguishes split-only `intent` from the recommended named `intent-reviewed` command, documents `--review-passes`, and defines no bare-command alias or implicit default.
- [x] `v2/docs/first-workflow-walkthrough.md` documents the reviewed operator path, zero-pass escape hatch, outputs, and failure boundary.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with preset registration, CLI selection, and default posture.
- Update `v2/docs/first-workflow-walkthrough.md` with the reviewed intent path.

# Select the review behavior for implement runs

`jarvis run workflow implement` always appends a debate review step when review
passes are positive. Operators need to pick the cheaper light review per run or
per project.

## Decisions

- Accept `--review-behavior debate|light` on implement; resolve from `projects.<key>.implement.reviewBehavior` when omitted, defaulting to `debate` — rules out silently switching existing v1-parity runs to light review.
- The flag overrides the project default — rules out an unconditional project setting.
- Reject bad values before daemon contact, each path matching how malformed `reviewPasses` is rejected on that same path today: an unknown `--review-behavior` value fails arg parsing and prints the implement workflow usage; a non-`debate|light` project config value returns a named error (`projects.<key>.implement.reviewBehavior must be "debate" or "light"`) printed to stderr — rules out surfacing either failure mid-run, and rules out a single uniform error shape that would diverge from the flag path's existing usage-error behavior. Both exit non-zero.
- Behavior selection applies only when resolved review passes are positive; zero passes stay review-free — rules out emitting an inert review step.
- `light` emits one `review` step (stepId `implement-review`, patch review context, `verdict-patch.md`); `debate` keeps emitting `review-debate` with the same stepId and verdict path — rules out behavior-specific alias presets and a second verdict artifact.

## Task checklist

- [x] Parse and validate `--review-behavior` for implement.
- [x] Read and validate the project review-behavior default.
- [x] Select the loaded light or debate review step in the implement step builder.

## Acceptance criteria

- [x] `jarvis run workflow implement --review-behavior light` with positive review passes runs a critic-actuator review of the branch after the linked subspec completes, writing its verdict to `verdict-patch.md`.
- [x] `--review-behavior debate` and an omitted flag with no project default both run the existing debate review — same step id and verdict path as before this change.
- [x] `projects.<key>.implement.reviewBehavior: "light"` makes light the default for that project's implement runs, and an explicit `--review-behavior debate` on such a run still runs debate.
- [x] An unknown `--review-behavior` value exits non-zero with the implement workflow usage, and a project `implement.reviewBehavior` that is not `debate` or `light` exits non-zero with a named error naming the offending config key — both before the daemon is contacted.
- [x] Zero resolved review passes launch a review-free implement workflow under either behavior.

## Documentation updates

- `v2/docs/install-and-config.md`: add `projects.<key>.implement.reviewBehavior` to the project config schema table with its default and validation.
- `v2/docs/first-workflow-walkthrough.md`: add `--review-behavior` to the implement flag table.
- `v2/docs/v1-behaviors.md`: update the `[v2 additive]` implement review entry with behavior selection.

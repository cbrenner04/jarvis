# Resolve implement review passes

`implement` needs one validated effective review count before it builds a workflow.

## Decisions

- Store the project default at `projects.<key>.implement.reviewPasses`; rules out a global default that cannot distinguish project posture.
- Accept only non-negative integers for CLI and project values; rules out coercing fractional, negative, or malformed counts.
- Prefer explicit `--review-passes` over the registered-project value; rules out config silently overriding an invocation.
- Default an absent CLI and project value to `0`; rules out adding review to existing implement launches.
- Reject a present-but-invalid project `implement.reviewPasses` (fractional/negative/malformed) at effective-count resolution, before daemon contact; rules out silently coercing or ignoring a bad config value.

## Tasks

- [x] Extend the v2 machine-config project reader with the validated implement review default.
- [x] Add `--review-passes <n>` to the implement workflow CLI parser, usage, and builder input.
- [x] Resolve the effective count from the matched registered project before daemon contact.
- [x] Cover CLI parsing, invalid values, project default, and CLI precedence.

## Documentation updates

- [x] Update `v2/docs/write-behavior.md` with the `jarvis run workflow implement --review-passes` CLI flag.
- [x] Update `v2/docs/install-and-config.md` with `projects.<key>.implement.reviewPasses` and its validation/default.
- [x] Update `v2/docs/first-workflow-walkthrough.md` with the implement flag and precedence.

## Acceptance criteria

- [x] `jarvis run workflow implement --review-passes <non-negative integer>` starts with that effective count, while malformed, fractional, and negative values fail before daemon contact.
- [x] An implement launch without the flag uses its registered project's valid `implement.reviewPasses`, or `0` when absent.
- [x] A present-but-invalid project `implement.reviewPasses` (fractional, negative, or malformed) fails at effective-count resolution before daemon contact, not silently coerced.
- [x] An explicit implement `--review-passes` value overrides the registered-project default.
- [x] `v2/src/cli.test.ts` and the configuration-reader tests cover the effective-count selection.

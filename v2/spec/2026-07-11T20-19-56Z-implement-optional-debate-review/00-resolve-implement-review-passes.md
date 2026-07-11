# Resolve implement review passes

`implement` needs one validated effective review count before it builds a workflow.

## Decisions

- Store the project default at `projects.<key>.implement.reviewPasses`; rules out a global default that cannot distinguish project posture.
- Accept only non-negative integers for CLI and project values; rules out coercing fractional, negative, or malformed counts.
- Prefer explicit `--review-passes` over the registered-project value; rules out config silently overriding an invocation.
- Default an absent CLI and project value to `0`; rules out adding review to existing implement launches.

## Tasks

- [ ] Extend the v2 machine-config project reader with the validated implement review default.
- [ ] Add `--review-passes <n>` to the implement workflow CLI parser, usage, and builder input.
- [ ] Resolve the effective count from the matched registered project before daemon contact.
- [ ] Cover CLI parsing, invalid values, project default, and CLI precedence.

## Documentation updates

- [ ] Update `v2/docs/install-and-config.md` with `projects.<key>.implement.reviewPasses` and its validation/default.
- [ ] Update `v2/docs/first-workflow-walkthrough.md` with the implement flag and precedence.

## Acceptance criteria

- [ ] `jarvis run workflow implement --review-passes <non-negative integer>` starts with that effective count, while malformed, fractional, and negative values fail before daemon contact.
- [ ] An implement launch without the flag uses its registered project's valid `implement.reviewPasses`, or `0` when absent.
- [ ] An explicit implement `--review-passes` value overrides the registered-project default.
- [ ] `v2/src/cli.test.ts` and the configuration-reader tests cover the effective-count selection.

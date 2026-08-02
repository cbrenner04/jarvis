1. Preserve the pre-extraction attached lifecycle: admission and `pipeline_wait` must use one connected client, without a new post-admission reconnect/failure window. The reusable API must still return after `pipeline_start`; waiting remains CLI-owned. This is required by both subspecs’ lifecycle- and CLI-preservation decisions.

2. Enforce seed exclusivity at runtime by property presence and valid string type. Inputs containing neither field, both fields, or malformed extra seed fields must return `invalid-seed-input` before configuration access or daemon contact.

3. Guarantee the declared result-union contract even if injected cleanup throws. Connection cleanup must not escape or replace an admitted or typed-failure result, especially after durable admission. Add direct coverage.

4. Add effective mutation coverage for the guard deciding whether seed-path validation runs. Inverting or bypassing that decision must make a focused refusal test fail, satisfying the requirement that every moved rejection guard has a valid `// @mutate` checkpoint.

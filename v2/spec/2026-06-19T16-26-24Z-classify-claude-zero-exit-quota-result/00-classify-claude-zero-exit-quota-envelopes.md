# Classify Claude zero-exit quota envelopes

Claude may exit `0` with an error envelope, preventing the existing quota
fallback from running.

## Decisions

- Require `is_error: true`, `api_error_status: 429`, and a quota message; do not classify every zero-exit Claude error envelope as quota.
- Classify in the Claude adapter before its zero-exit result becomes `ok`; do not add a patch-mode exception.
- Preserve the full envelope as quota diagnostics; do not replace it with parsed display text.

## Tasks

- [ ] Classify the reported zero-exit monthly-spend-limit envelope at the Claude adapter boundary.
- [ ] Cover non-quota zero-exit envelopes and patch fallback using the same reported shape.
- [ ] Align the quota-signal and v1 behavior documentation.

## Acceptance criteria

- [ ] A Claude exit-0 JSON envelope with `is_error: true`, `api_error_status: 429`, and `"You've hit your monthly spend limit"` is `kind: "quota"` and retains its diagnostics.
- [ ] A successful Claude JSON envelope and zero-exit structured errors without both the semantic 429 and quota message remain non-quota.
- [ ] A patch run receiving the reported Claude envelope rotates to the next configured agent through existing quota fallback.
- [ ] Regression tests cover the Claude classification boundary and patch fallback with the reported envelope.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- [ ] `v1/docs/quota-signals.md` records the verified monthly-spend-limit JSON sample and its zero-exit quota behavior.
- [ ] `v2/docs/v1-behaviors.md` records Claude zero-exit quota classification and fallback behavior with source citations.

## Out of scope

- New fallback policy.
- Non-Claude classification changes.

# 01 - Drop dead model fallbacks at plan-mode call sites

## Problem

Plan-mode files log the agent's configured model with a `?? "default"` fallback, e.g. `entry.model ?? "default"`. Because `src/config.ts` validates that every agent entry has a non-empty, known-priced `model` at load time, the fallback is unreachable: by the time plan modes run, `entry.model` is always a string. The fallback exists only because the type used to permit `undefined`.

Once subspec `00` tightens the factory signature so `model: string` is the encoded invariant, the `?? "default"` fallbacks in plan-mode logging become obviously dead and should be removed for clarity.

## Decisions

- **Scope is logging only.** This subspec touches `entry.model ?? "default"` (and any equivalent `model ?? "default"` log fallback) in plan-mode files. It does not change call signatures, control flow, or anything outside log strings.
- **The replacement is the bare value.** `entry.model ?? "default"` becomes `entry.model`. Log message wording is otherwise unchanged.
- **Patch mode is out of scope.** `src/modes/patch/run.ts` is reviewed but not edited unless it contains the same dead fallback pattern.

## Tasks

- Grep `src/modes/plan/` for `?? "default"` and for `model ?? `; identify every occurrence that resolves a configured agent `model` for logging.
- For each occurrence in `src/modes/plan/draft.ts`, `src/modes/plan/interview.ts`, `src/modes/plan/name-only.ts`, and `src/modes/plan/review.ts`, replace `entry.model ?? "default"` (or the equivalent shape) with `entry.model`.
- Leave any unrelated `?? "default"` fallbacks (i.e. ones that are not resolving an agent model) untouched.
- Do not change patch mode unless it contains the same dead pattern; if it does, apply the same cleanup there.
- Update or remove any test that asserts the literal string `"default"` appears in a log because of this fallback. If no test asserts this, no test changes are required.

## Acceptance criteria

- [x] `src/modes/plan/draft.ts`, `src/modes/plan/interview.ts`, `src/modes/plan/name-only.ts`, and `src/modes/plan/review.ts` contain no `entry.model ?? "default"` (or `model ?? "default"`) expression for logging an agent's configured model.
- [x] The log message text surrounding each removed fallback is otherwise unchanged (only the `?? "default"` tail is removed).
- [x] No call to `createAgent` in plan-mode files passes `undefined` for `model`; each passes `entry.model` directly.
- [x] Unrelated `?? "default"` expressions elsewhere in the codebase are not modified.
- [x] The project type-checks cleanly after this change.

## Documentation

- No documentation changes required.

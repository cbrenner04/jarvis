# Classify Completion Commits and Pending Recovery

## Problem

Completion commits do not record their workflow purpose, and retrying a pending transaction can lose or invent that classification.

## Decisions

- The committer accepts optional step metadata and writes `Jarvis-Step: write` when it is absent; direct write subjects remain the bare creation title.
- A prepared pending message is authoritative on retry: its subject, body, and valid trailer lines, including a valid persisted `Jarvis-Step`, are retained verbatim and retry-time metadata cannot reclassify it.
- A trailer-less legacy pending message is upgraded once by appending `Jarvis-Step: write` in the trailer block; it otherwise retains its stored subject, body, and valid trailers.
- Valid persisted step values are `write`, `review <positive decimal pass>`, `review-debate <positive decimal pass>`, `mutation-repair`, and `ready-gate`; new pending records persist the selected metadata with the prepared message.

## Tasks

- Extend the completion-commit contract and pending record to select a step, render its trailer, and preserve the bare write title.
- Make pending recovery preserve prepared valid step trailers, upgrade only trailer-less legacy messages to `write`, and reject retry-time reclassification.
- Add focused completion-commit regressions and document the completion and resume message contract in `v2/docs/write-behavior.md`.

## Acceptance criteria

- [x] A direct write/completion commit keeps `<title>` and adds `Jarvis-Step: write` beside `Jarvis-Agent`; a stored pending commit without step metadata resumes with the same write classification. `v2/src/execution/completion-commit.test.ts` test `defaults absent and legacy pending step metadata to write` fails against the pre-fix message. `v2/src/execution/completion-commit.test.ts` — `defaults absent and legacy pending step metadata to write`; Keystone checkpoint: its pinning test carries `` `// @mutate v2/src/execution/completion-commit.ts "}\n${renderJarvisStepTrailer(step)}`," -> "}`,"` `` inside the test body — dropping the `Jarvis-Step` trailer from a freshly prepared completion message — and the mutation turns that regression RED.
- [x] A retry of a prepared review, mutation-repair, or ready-gate pending commit preserves its stored subject and valid `Jarvis-Step`, even when the retry input supplies different metadata; the focused test fails against a retry that reclassifies the transaction. `v2/src/execution/completion-commit.test.ts` — `preserves prepared pending step message on retry`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/execution/completion-commit.ts "if (JARVIS_STEP_TRAILER_PRESENT.test(pending.message)) return pending;" -> "if (false) return pending;"` inside the test body — always re-appending `Jarvis-Step: write` even onto an already-classified prepared message — and the mutation turns that regression RED.
- [x] A legacy trailer-less prepared message gains only `Jarvis-Step: write`, while a prepared message with one valid step trailer is not rewritten or duplicated. `v2/src/execution/completion-commit.test.ts` — `upgrades only trailerless legacy pending messages`; Mutation checkpoint: its pinning test carries the same `// @mutate v2/src/execution/completion-commit.ts "if (JARVIS_STEP_TRAILER_PRESENT.test(pending.message)) return pending;" -> "if (false) return pending;"` inside the test body — upgrading a message that already carries a valid `Jarvis-Step` trailer and duplicating it — and the mutation turns that regression RED.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` documents step-aware direct completion, legacy pending upgrade, and prepared-message retry authority.

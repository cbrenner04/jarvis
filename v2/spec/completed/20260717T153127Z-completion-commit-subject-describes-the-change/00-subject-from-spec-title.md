# Derive completion commit subject from spec title; recognize prior commit by trailer

## Problem

Every v2 completion commit hardcodes the subject `jarvis: complete run`
(`v2/src/execution/completion-commit.ts:71`), so `git log` on `main` is a wall of
identical subjects — `bisect`, `blame`, `--oneline`, and squash-merge subjects
all lose signal. The subject should describe the change. The already-committed
idempotency check keys on that literal subject
(`completion-commit.ts:60`, `headMessage.startsWith("jarvis: complete run")`);
a variable subject breaks it, so it must switch to a marker that survives.

## Decisions

- Completion commit subject = the resolved publication title (spec `index.md` H1,
  same value as `resolvePublicationTitle` in
  `v2/src/execution/spec-creation-title.ts`); rules out a fresh/independent
  derivation that could diverge from the PR title.
- Reuse `resolvePublicationTitle`'s existing fallbacks (basename when no index /
  no heading) rather than inventing a new empty-title fallback.
- `Spec:` and `Jarvis-Agent:` trailers stay in the message body verbatim
  (`pr-attribution.ts` / `pr-body-refresh.ts` parse them).
- Idempotency check recognizes a prior completion commit by the `Jarvis-Agent:`
  trailer line, not the subject; rules out matching a new fixed subject prefix,
  which reintroduces the wall-of-identical-subjects the intent removes.
- Retry path unchanged: `jarvis-completion-pending.json` already stores the full
  message, so an in-flight retry reuses the original subject.

## Task checklist

- Compute the subject from the spec title in `completion-commit.ts` (reusing the
  `resolvePublicationTitle` resolution) and use it as the `-m` subject line,
  keeping the `Spec:` and `Jarvis-Agent:` trailer body.
- Replace the `headMessage.startsWith("jarvis: complete run")` idempotency test
  with a `Jarvis-Agent:` trailer check on the HEAD message.
- Update `completion-commit.test.ts`: assert the committed subject is the spec
  title, and that the resume-reports-existing-sha path recognizes the prior
  commit via its `Jarvis-Agent:` trailer with a non-`jarvis: complete run`
  subject.
- Update docs.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the v2 completion-commit subject/trailer
  contract (subject = spec title; `Spec:`/`Jarvis-Agent:` trailers preserved;
  idempotency keyed on the `Jarvis-Agent:` trailer).
- `v2/docs/write-behavior.md` — the completion-commit description currently says
  a fixed `jarvis: complete run` subject; update it to the spec-title subject.

## Acceptance criteria

- [x] The v2 completion commit subject equals the resolved spec title (spec
  `index.md` H1, matching `resolvePublicationTitle`), not the literal
  `jarvis: complete run`.
- [x] The completion commit message still carries the `Spec: <specPath>` and
  `Jarvis-Agent: <agent>` trailer lines.
- [x] The already-committed idempotency path recognizes a prior completion commit
  whose HEAD subject is not `jarvis: complete run` (recognized via its
  `Jarvis-Agent:` trailer) and reports its existing sha instead of a no-op.
- [x] A HEAD commit with no `Jarvis-Agent:` trailer and an unchanged tree is
  still treated as "nothing to commit" (returns `{}`).
- [x] An updated/added test in `completion-commit.test.ts` asserts the spec-title
  subject and the trailer-based idempotency; it fails against the pre-fix code
  (which emits/matches the fixed `jarvis: complete run` subject) and passes after
  the change.
- [x] `v2/docs/v1-behaviors.md` and `v2/docs/write-behavior.md` describe the
  spec-title subject and trailer-based idempotency contract.

---
name: plan-normalizer-honors-declared-single-surface
---

# Plan-draft normalizer honors the intent's declared single surface

## Problem

The intent split stage already decides surface scope: a single-surface intent carries an `Unsplit rationale:` line (or a `## Module-boundary surface` section) stating why splitting does not apply. The plan-draft normalizer (`normalizePlanDraftSpecDir` in `shared/module-boundary-surfaces.ts`) ignores that declaration and re-derives surfaces by keyword regex over `## Acceptance criteria` bullets (`\bdaemon\b`, `\b(?:ipc|rpc)\b`, `\bcli\b`, `\bflags?\b`, `\bpersist…\b`, …). A CLI-only spec whose criteria merely *mention* the daemon as an unchanged dependency ("byte-for-byte the current daemon snapshot", "no daemon request", "daemon-returned state") classifies as `cli` + `daemon`, the normalizer attempts a split, and hard-errors on the first bullet matching both — writing an `Artifact contract check failed: … multi-surface ## Acceptance criteria bullet` blocker. Observed on `pipeline-list-human-readable` (2026-08-16/17): five consecutive plan runs stranded on this; the redraft naturally re-mentions `daemon` because the intent's own Decisions do; the tree had to be hand-landed (PR #2877). Vocabulary scrubbing is not a fix — the words are correct.

## Decisions

- When the intent declares a single surface (`Unsplit rationale:` line and/or a `## Module-boundary surface` section naming one surface, as emitted by `prompts/intent/split.md`), the plan-draft normalizer skips module-boundary splitting and the multi-surface bullet hard-error for that plan; keyword classification is not consulted. Rules out re-deriving a decision the intent stage already made and reviewed.
- Absent any declaration, current keyword-driven behavior is unchanged. Rules out weakening the split for legacy or hand-authored intents that never declared scope.
- The declaration is read from the staged `intent.md` (the plan input), not from subspec bodies; a subspec cannot opt itself out. Rules out agents dodging the split by adding prose.
- Optionally, when the declaration names a surface that *disagrees* with the keyword-classified union (e.g. declares `cli` but criteria mention only `persistence`), the normalizer still skips the split but the plan-draft diagnostic context reports the mismatch so the reviewer sees it. Plan decides whether that is in scope; the skip itself is not conditional on agreement.
- The `intent-split` prompt already requires the one-line rationale; if the exact grammar the normalizer keys on needs tightening (a fixed prefix or a fenced surface name), change the prompt and its regression tests in the same spec so producer and consumer agree. Rules out the normalizer parsing free prose heuristically.

## Acceptance criteria

- [ ] A regression test fails against the current normalizer and proves that a staged plan whose `intent.md` declares a single surface, with acceptance bullets that keyword-classify as two surfaces (one bullet matching both), normalizes without error, without splitting, and without rewriting subspec files.
- [ ] A test proves that the same staged plan with no declaration still splits (or hard-errors on the multi-surface bullet) exactly as today.
- [ ] A test proves that a declaration placed only in a subspec body, not `intent.md`, does not suppress the split.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — plan-draft normalizer: declared single-surface intents bypass module-boundary splitting; keyword classification applies only to undeclared intents.
- `v1/docs/spec-guidance.md` — the intent's `Unsplit rationale:` / module-boundary declaration is load-bearing downstream (plan normalizer), not just review prose.
- `v2/docs/v1-behaviors.md` — align the plan-draft normalizer entry.

## Notes

- Sibling in flight: `clear-plan-draft-harness-blocker-before-redraft` handles the stale-blocker aftermath of the same failure; this seed removes the false trigger. Land this one after it or off its merged result — both touch plan-draft normalizer diagnostics.
- This seed's own plan will mention `daemon`, `cli`, and `persistence` as vocabulary in its criteria; it must carry a single-surface declaration (execution loop / plan-draft normalization) or it will strand on the very bug it fixes.

# 00 - PR body renders a workflow-supplied summary

`refreshPrBody` renders `Spec: <path>` + preserved narrative + attribution footer. Nothing describes the change. Add the transport: an optional pre-rendered summary block the caller supplies, rendered inside the existing body structure. No workflow supplies one yet (01/02 do).

## Decisions

- Publisher takes an already-rendered `bodySummary?: string`, not a descriptor it interprets — rules out a publisher-side renderer switch that would force every workflow's body shape into `execution/completion-publisher.ts`.
- Summary renders between the `Spec:` line and the narrative markers — rules out replacing the `Spec:` pointer (intent requires it stays) and rules out below-footer placement.
- Absent/blank `bodySummary` ⇒ today's body, byte-for-byte — the implement path and any un-migrated caller must not change.
- `bodySummary` flows publisher-input → `refreshPrBody` only; it is not persisted on the run row (recomputed per publish from durable spec state, so retries and resumes regenerate it).
- Non-workflow publish sites — direct `jarvis2 write` and the daemon — supply no summary and keep today's body; they are the named consumers of the absent-summary fallback, not a hypothetical.
- The summary block is part of the rebuilt header (rebuilt from scratch on every refresh, like `Spec:`) — rules out inventing summary-specific delimiters; idempotence and replace-on-change fall out of the existing header rebuild.

## Acceptance criteria

- [x] `refreshPrBody` accepts an optional summary and renders it after the `Spec:` line and before the narrative markers / footer.
- [x] With no summary supplied, existing `pr-body-refresh.test.ts` body-shape tests stay green (body unchanged).
- [x] `createCompletionPublisher` passes a `bodySummary` from its input through to `refreshPrBody`; `publishCompletionArtifacts` (`v2/src/execution/write-loop.ts`) forwards it.
- [x] `pr-body-refresh.test.ts` header-rebuild + narrative-preservation tests stay green with a summary supplied: a re-refresh with the same summary is byte-identical, and a refresh with a different summary replaces the prior block.

## Documentation updates

- `v2/docs/write-behavior.md` — PR body refresh section: document the summary block, its position, and the absent-summary fallback.

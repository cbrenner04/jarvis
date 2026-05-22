# 04 — Side effects, completion, blockers, and failures

## Problem

Several of the most important parity behaviors in v1 are not about command
entry points but about what the harness writes, logs, emits, refuses to do, or
considers complete. These behaviors span logging, telemetry, prompt/spec
parsing, log-server preflight, completion detection, blocker handling, and
exit/failure semantics.

## Scope

Fully author these sections in `v2/spec/v1-behaviors.md`:

- Filesystem, logging, telemetry, and other side effects
- Completion, blockers, exit codes, and failure handling
- Behaviors with uncertain intent
- Surprising or possibly vestigial behaviors

This subspec owns the catalog's catch-all behavior sections. Use them to record
real ambiguities or surprising source-backed behaviors, not generic caveats.
When a behavior clearly belongs in another top-level section, add at most a
cross-reference there and keep the substantive entry in its natural home.

## Primary sources

- `v1/src/logging.ts`
- `v1/src/log-server-preflight.ts`
- `v1/src/mode-entry.ts`
- `v1/src/telemetry.ts`
- `v1/src/telemetry-enrichment.ts`
- `v1/src/run-summary.ts`
- `v1/src/modes/patch/completion.ts`
- `v1/src/modes/patch/blocker.ts`
- `v1/src/modes/patch/prompt.ts`
- `v1/src/modes/patch/spec.ts`
- `v1/docs/agent-cli-failure-pipeline.md`

## Task checklist

- [ ] Audit logging and telemetry side effects, including log-server
      requirements, default endpoints, emitted summaries, and any user-visible
      usage/cost enrichment behavior.
- [ ] Document the shared preflight behavior that gates `run` and `plan` on log
      server reachability before any agent work begins, including the specific
      operator-facing failure mode and exit behavior.
- [ ] Capture filesystem side effects that matter to users or reviewers, such
      as session files, telemetry files, logs, or other durable artifacts that
      the source shows v1 creating or updating.
- [ ] Normalize any `[uncertain]` entries or surprising-behavior entries seeded
      by earlier subspecs so these catch-all sections become the catalog's
      single review location for unresolved or vestigial behaviors.
- [ ] Audit patch-mode completion and blocker detection, including what counts
      as spec completion, how blockers are surfaced, and how malformed spec
      structure is handled.
- [ ] Record failure and exit semantics from the source and docs, including
      hard errors, preflight failures, abort behavior, and any cases where the
      harness reports failure without falling back.
- [ ] Populate `## Behaviors with uncertain intent` only with source-backed
      ambiguities, and populate `## Surprising or possibly vestigial behaviors`
      only with observable behaviors that are surprising, legacy-shaped, or
      weakly justified by current docs.

## Acceptance criteria

- [x] `v2/spec/v1-behaviors.md` contains substantive sections for side effects,
      completion/blockers/failures, uncertain behaviors, and surprising or
      possibly vestigial behaviors.
- [x] The side-effects section documents the log-server preflight gate,
      logging/telemetry behavior, and other durable artifacts visible to users.
- [x] The completion/failure section captures completion detection, blocker
      handling, and exit/failure semantics sourced from the patch-mode and
      failure-pipeline code/docs.
- [x] Any uncertainty or vestigial-behavior entries introduced earlier in the
      catalog have been consolidated into the dedicated catch-all sections
      unless they need a brief cross-reference in their original area.
- [x] The uncertain and surprising sections contain only source-backed entries;
      uncertain items are tagged `[uncertain]` with a brief explanation.
- [x] Every behavior entry added by this subspec cites at least one supporting
      source file.

## Documentation updates

- [x] `v2/spec/v1-behaviors.md` is updated for the side-effect, completion, and
      failure behavior areas owned by this subspec.

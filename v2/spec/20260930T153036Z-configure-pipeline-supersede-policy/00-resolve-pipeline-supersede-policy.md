# Resolve pipeline supersede policy at project-pipeline admission

Terminal publication can close earlier stage PRs, but project config cannot yet admit whether that should happen. Extend project-pipeline resolution so an optional `supersede` policy defaults to closing, copies onto the admitted pipeline definition, and rejects malformed values before admission effects.

## Decisions

- `projects.<key>.pipeline` allowlist gains optional `supersede` alongside `name`, `terminalAction`, and `reviewOverrides`; rules out a top-level project key or daemon-only knob for the same policy.
- `supersede` defaults `"close"` when absent; rules out requiring an explicit key the way `terminalAction` does.
- Allowed values are exactly `"close"` and `"keep"`; rules out booleans, synonyms, or case variants.
- `PipelineDefinition.supersede` is optional on the type (source-registry rows omit it); successful `resolveProjectPipeline` output always sets it, mirroring `terminalAction`; rules out a required field on static registry templates and ambiguous full-definition fixtures.
- Unknown `supersede` parse errors use the same shape as `terminalAction` negatives: full config path key plus `has unknown value "<raw>"`; rules out divergent table-driven error text.
- Empty-string `supersede` fails `must be a non-empty string`; whitespace-only non-empty strings fail `has unknown value "…"` after the same string checks as `terminalAction`; rules out trim-normalization or a separate malformed-type path for whitespace-only.
- Resolution deep-copies the selected source definition, applies existing override and `terminalAction` composition, then sets `supersede` on the owned result; rules out mutating registry source rows or re-reading project config after admission.
- Parse-time `supersede` failures return `invalid-project-pipeline-config` naming the full offending config path and occur before registry lookup when parse order permits; rules out `unknown-pipeline` or `invalid-pipeline-definition` for config-shape mistakes.
- Deferred to first consumer: how admitted `supersede` drives comment-and-close of preceding stage PRs at terminal publication — pin when the settlement slice that consumes admitted definitions implements supersede calls.
- Deferred to first consumer: persisted admitted pipeline JSON without `supersede` — pin default when settlement/load path reads stored definitions.

## Task checklist

- Add `PIPELINE_SUPERSEDE_POLICIES` (or equivalent) and optional `supersede` on `PipelineDefinition`; extend `parseProjectPipeline` allowlist, defaulting, and validation; set `supersede` in `resolveProjectPipeline` after copy and `terminalAction` assignment.
- Extend `project-pipeline-resolution.test.ts` with default/explicit resolution and copy isolation, malformed and unknown `supersede` negatives with lookup-spy ordering (no lookup on parse failures only), and forbidden-key coverage if not already implied by the shared table.
- Repair compile/fixture fallout where admitted definitions must carry `supersede` (tests and any admission fixtures that construct full `PipelineDefinition` objects); run `bun run typecheck`.
- Document operator config values, default, validation, admitted-definition immutability, and that terminal publication does not consume `supersede` until the settlement slice; record v2 admission behavior in `v1-behaviors.md` with `[v2 additive]` and Sources.

## Acceptance criteria

- [ ] `project-pipeline-resolution.test.ts` — coverage added that fails against the baseline and proves absent `supersede` composes `"close"` and explicit `"keep"` composes `"keep"` onto independently owned admitted definitions for the same registry pipeline without mutating the source row or sibling resolved copies.
- [ ] `project-pipeline-resolution.test.ts` — coverage added that fails against the baseline and proves unknown and malformed `supersede` values return `invalid-project-pipeline-config` with full config paths, unknown values use `has unknown value "…"` message parity with `terminalAction` parse negatives, and a registry lookup spy shows no lookup on parse failures only.
- [ ] `bun run typecheck` passes after `PipelineDefinition` / admitted literal fallout from resolved `supersede`.
- [ ] `v2/docs/install-and-config.md` documents `projects.<key>.pipeline.supersede` (`"close"`, `"keep"`), default `"close"`, allowlist and validation, that resolution copies the policy onto the admitted definition only and terminal publication does not consume it until the settlement slice, and the canonical complete project example omits default `supersede` while the table documents the key.
- [ ] `v2/docs/v1-behaviors.md` includes a `[v2 additive]` bullet with Sources citing admission-time resolution that records resolved `supersede` on the immutable admitted pipeline definition (admission-only; no publication behavior change in this slice).

## Documentation updates

- `v2/docs/install-and-config.md` — table row and prose for `projects.<key>.pipeline.supersede`; allowlist includes `supersede`; canonical complete project example omits default `supersede`; note resolution vs terminal-publication consumption.
- `v2/docs/v1-behaviors.md` — `[v2 additive]` bullet with Sources (`v2/src/execution/project-pipeline-resolution.ts`, related admission paths) for admitted-definition `supersede`.

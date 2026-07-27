- Resolve the admission contradiction. A pure resolver proves isolation, not that production admission invokes validation before creating a run row, worktree, or agent invocation. The spec must cover an actual admission-facing seam and verify zero effects on failure, or explicitly block/resequence this intent until such a seam exists. It cannot both defer wiring and claim the intent’s pre-admission guarantee.

- If admission enforcement remains in scope, split the draft into independently testable parsing/resolution and admission-ordering subspecs. Preserve every original task and acceptance outcome exactly once across the replacements, and link every replacement from `index.md`.

- Define configuration ownership and resolver inputs. State how pipeline fields survive the existing project-registry projection, which component reads/parses them, and what project/config data the resolver receives.

- Pin the complete strict schema: missing or non-object `pipeline`, missing/empty/non-string `name`, malformed `reviewOverrides`, non-string override values, and all forbidden keys must return named, path-specific errors.

- Clarify precedence across parsing, registry lookup, override-target checks, and composed-definition validation. Deterministic phase ordering is required; ordering among equivalent malformed override entries need not be contractual.

- Require unconditional definition validation, including selections with no overrides. The contract is the existing pipeline-definition validator—not a broader promise that all later dispatch failures are impossible.

- Define how pipeline-stage review posture relates to existing `projects.<key>.implement.reviewBehavior`. The spec and operator documentation must make their respective scopes and precedence unambiguous.

- Strengthen isolation guarantees. Resolution must return independently owned definition and stage objects, including when no override applies, unless source definitions are instead contractually deeply immutable.

- Replace structural “missing module” baseline evidence with a behavioral regression test through an existing config/admission-facing entry point. It must fail by assertion before the change and pass afterward; guard-inversion checks remain additionally required.

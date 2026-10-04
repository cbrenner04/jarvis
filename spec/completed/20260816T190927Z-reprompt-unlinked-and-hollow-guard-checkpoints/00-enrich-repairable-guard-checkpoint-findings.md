# Enrich repairable guard checkpoint findings

## Problem

The completion verifier knows whether a guard has no linked `// @mutate` directive or a linked directive whose mutation leaves the scoped suite green, but its report cannot unambiguously drive a repair prompt when a criterion has multiple linked directives.

## Behavior

Every repairable guard finding reports its criterion, checkpoint kind, resolved repo-relative pin path, and reason. An `unlinked` guard reports that its directive is absent; a `hollow` guard reports the linked directive's stable source identity, including its repo-relative `path:line` and directive text. Unlinked keystone findings retain their distinct keystone kind for the following execution-loop slice.

## Decisions

- Keep directive-present-versus-absent classification in verifier output: no linked directive is `unlinked`; a linked directive whose mutation leaves the scoped suite green is `hollow`; rules out collapsing both cases into a generic checkpoint miss.
- Give each hollow finding the actual linked directive's `path:line` plus directive text; rules out criterion-only identity when several directives link to the same criterion.
- Preserve checkpoint kind (`guard` or `keystone`) in structured findings; rules out treating an unlinked keystone as a guard before prompt selection.
- Do not change completion admission or prompts in this slice; rules out coupling report shape to write-loop policy.

## Task checklist

- [ ] Populate the resolved repo-relative pin path on every unlinked or hollow guard report entry while preserving the existing directive-present distinction.
- [ ] Add checkpoint kind and a stable linked-directive identity to repairable findings, including directive `path:line` and text for each hollow guard.
- [ ] Cover absent-versus-present reason mapping and multiple linked directives for one criterion in verifier tests.

## Acceptance criteria

- [x] Completion reports a repairable unlinked guard with its criterion, `guard` kind, resolved repo-relative pin path, and `unlinked` reason, and a hollow guard with the same fields plus the linked directive's repo-relative `path:line` and directive text; test `guard checkpoint repair findings identify pins and directives` in `v2/src/execution/write.test.ts` fails against the pre-fix code and passes after.
- [x] When several directives link to one criterion, a hollow finding identifies the directive that was mutated rather than another linked directive; test `guard checkpoint repair findings identify pins and directives` in `v2/src/execution/write.test.ts` covers the ambiguity.
- [x] `v2/src/execution/write.test.ts` — `hollow guard miss is reprompt eligible`; Mutation checkpoint: inverting the coarse `Hollow mutation checkpoints` repair-eligibility guard turns this pin red.
- [x] `v2/src/execution/write.test.ts` — `guard checkpoint repair findings identify pins and directives`; Mutation checkpoint: directives invert the linked-directive-present classification that maps absent directives to `unlinked` and present green mutations to `hollow`, and the test turns red.

## Documentation updates

- None — this verifier-only report contract is consumed and documented with the execution-loop repair behavior in the next serial subspec.

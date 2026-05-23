# Prompt Registry Renderer

Implement the second prompt-migration stage after relocation-only extraction:
metadata-first prompt registration by stable ID, registry-load validation,
shared renderer invariants, and revision-aware rendered snapshots.

This stage stays mechanically separate from prompt moves or wording edits. It
targets the first shared agent-facing prompt contract for v1 surfaces such as
the patch prompt body, injected patch rules, and the plan draft/review/refine
prompts, while keeping human-facing CLI chooser text and broader prompt rewrites
out of scope.

- [x] [00 - Registry metadata and load validation](./00-registry-metadata-and-load-validation.md)
- [ ] [01 - Renderer contract and runtime boundaries](./01-renderer-contract-and-runtime-boundaries.md)
- [ ] [02 - Revision-aware snapshots and documentation](./02-revision-aware-snapshots-and-documentation.md)

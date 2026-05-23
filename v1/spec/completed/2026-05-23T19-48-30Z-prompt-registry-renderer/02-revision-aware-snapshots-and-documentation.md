# 02 - Revision-aware snapshots and documentation

## Problem

After registry load and render behavior are defined, prompt changes still need a
deterministic review surface. Today v1 has prompt-building tests around plan
mode, but this migration stage needs rendered snapshots that make stable prompt
identity and revision changes visible without conflating shared prompt content
with adapter-local transport wrappers.

The intent also requires documentation updates that explain the new validation
and snapshot rules. Without that documentation, later prompt edits are likely to
reintroduce path-coupled lookups, silent validation drift, or wrapper sprawl.

## Decisions

- Shared rendered snapshots are keyed by prompt `id` plus `revision`. These
  snapshots cover the shared agent-facing prompt body assembled before
  transport-specific wrapping.
- Wrapper snapshots are recorded separately for adapter-local post-render
  variants. They reuse the shared prompt identity (`id` + `revision`) and add a
  thin wrapper variant label rather than minting wrapper-specific prompt IDs.
- Snapshot coverage should include both patch and plan prompt surfaces that are
  part of the first registry rollout, including step renders and at least one
  wrapper case such as the Codex transport layer.
- Deterministic tests in this stage focus on renderer correctness and snapshot
  naming/coverage, not broader behavioral eval infrastructure.
- Documentation changes land as part of this subspec so the stable review and
  maintenance contract ships with the snapshot mechanism.

## Task checklist

- [ ] Add rendered snapshot fixtures or snapshot generation helpers keyed by
      prompt ID and revision for the included shared prompt renders.
- [ ] Add separate wrapper snapshot coverage for the adapter-local variants that
      apply after shared rendering.
- [ ] Ensure snapshot naming and lookup make revision changes visible in review.
- [ ] Add or update tests that assert deterministic coverage for both shared
      render and wrapper variants.
- [ ] Update prompt-governance and developer docs for registry validation,
      renderer invariants, and snapshot keying.

## Acceptance criteria

- [x] Rendered snapshot outputs are keyed by prompt ID and revision for the
      shared prompt body covered by this migration stage.
- [x] Wrapper snapshots are stored or named separately from shared render
      snapshots and record the wrapper variant without turning wrappers into new
      shared prompt IDs.
- [x] Snapshot tests cover both step-render variants and adapter-wrapper
      variants for the included prompt surfaces.
- [x] Tests deterministically cover ordering, explicit overrides, placeholder
      validation, delimiter preservation, non-recursive substitution, wrapper
      selection, and ID-validation failures, with the failure-path assertions
      split cleanly between registry-load errors and render-time errors.
- [x] Prompt governance and developer docs describe the registry validation
      rules, the renderer contract invariants, and the snapshot keying scheme by
      ID plus revision.
- [x] The resulting change set remains reviewable independently of relocation
      extraction and does not introduce prompt wording rewrites or broader eval
      infrastructure.

## Documentation updates

- [ ] Update the shared prompt-governance design/doc to capture revision-aware
      snapshot keying, wrapper snapshot separation, and the load-vs-render
      failure boundary.
- [ ] Update the relevant v1 docs that explain prompt rendering and maintenance
      so contributors know which tests/snapshots must move when prompt metadata,
      revisions, or wrappers change.

## Out of scope

- Prompt eval infrastructure beyond deterministic rendered snapshots.
- Reclassifying wrappers as stable prompt identities.
- Broader prompt extraction or relocation work from the prior migration stage.

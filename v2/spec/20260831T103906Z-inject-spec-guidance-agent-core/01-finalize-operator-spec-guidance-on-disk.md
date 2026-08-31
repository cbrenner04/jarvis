# Finalize operator spec-guidance on disk

## Problem

The lossless split left `v1/docs/spec-guidance.md` byte-identical to the merge-base monolith and `v1/docs/spec-guidance-operator.md` as interim staging. Steady state needs one operator document at the historical path, no staging copy, and no duplicate authoring paragraphs across three files.

## Decision ledger

- Overwrite `v1/docs/spec-guidance.md` with the full content of `v1/docs/spec-guidance-operator.md`; rules out a thin redirect stub at the operator path.
- Delete `v1/docs/spec-guidance-operator.md` after the overwrite; rules out three on-disk copies of operator authoring rules.
- Repoint the agent-core intro cross-link from the staging path to `v1/docs/spec-guidance.md`; rules out a broken link after staging removal.
- Leave `v2/docs/spec-guidance-agent-core.md` content unchanged except the operator cross-link; rules out re-partitioning paragraphs in this subspec.

## Prerequisites

- Subspec 00 lands: runtime `SPEC_GUIDANCE` reads the agent core, not the monolith.

## Task checklist

- Replace `v1/docs/spec-guidance.md` with the current `v1/docs/spec-guidance-operator.md` body (full replace at the existing path).
- Delete `v1/docs/spec-guidance-operator.md`.
- Update `v2/docs/spec-guidance-agent-core.md` operator cross-link to `../../v1/docs/spec-guidance.md`.
- Verify the split inventory from `20260831T095540Z-split-spec-guidance-documents/00-lossless-split-spec-guidance.md` matches the on-disk partition.

## Acceptance criteria

- [ ] `v1/docs/spec-guidance.md` contains operator sections from the split inventory (`## Spec location conventions`, `## Land the spec before implementing it`, `## Plan same-seam siblings serially`, operator `## Authoring`, `## Non-index spec handling`) and does not duplicate agent-core-only sections such as `## Subspecs` or `## Agent Workflow`.
- [ ] `v1/docs/spec-guidance-operator.md` is absent from the repository.
- [ ] `v2/docs/spec-guidance-agent-core.md` links to `v1/docs/spec-guidance.md`, not the removed staging path.
- [ ] Every former merge-base `v1/docs/spec-guidance.md` section appears in exactly one on-disk document; the split inventory matches the landed files. (no automated guard)

## Documentation updates

- `v1/docs/spec-guidance.md` — operator monolith content (via overwrite).
- `v2/docs/spec-guidance-agent-core.md` — operator cross-link target only.

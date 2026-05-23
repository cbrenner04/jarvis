# Prompt relocation stage one

repo: cbrenner04/jarvis

Relocate the current v1-owned prompt artifacts into a shared prompt source
tree without changing wording, rendered output, or prompt composition
semantics. This stage is limited to mechanical extraction plus the loader/path
updates needed for v1 to read the moved artifacts.

## Subspecs

- [x] [00 — Relocate patch prompt artifacts into shared source](./00-relocate-patch-prompt-artifacts-into-shared-source.md)
- [x] [01 — Relocate plan prompt templates into shared source](./01-relocate-plan-prompt-templates-into-shared-source.md)
- [x] [02 — Finish ownership cleanup and prompt-location documentation](./02-finish-ownership-cleanup-and-prompt-location-documentation.md)

## Conventions

- The shared destination for this tree is the repo-level `prompts/` source
  chosen by `v2/spec/prompts.md`. Do not reopen that location decision inside
  these subspecs.
- Keep the extraction boundary mechanical. Move prompt-owned text only; keep
  runtime formatting, interpolation, and conditional assembly logic in
  TypeScript.
- Slice 00 must cover all current readers of the relocated patch artifacts, not
  only patch-mode prompt assembly. If a legacy v1 path would still be required
  at runtime after relocation, that cleanup belongs with the slice that moved
  the artifact.
- Land ownership cleanup with the slice that moves each prompt body. The final
  docs slice should verify and explain that ownership story, not re-open the
  prompt-migration work.
- Use a one-artifact-per-file mapping in the new shared prompt tree so review
  diffs clearly separate moved text from loader updates.
- Do not introduce prompt IDs, registries, rendered snapshots, revision
  metadata, fragment layering, or new wrapper semantics in this tree.
- Avoid leaving two editable copies of the same prompt text in place. Legacy
  v1 paths may become thin readers or be deleted, but they must not remain a
  second prompt source of truth.
- Keep interactive/operator prompts such as repository disambiguation and
  non-index confirmations out of scope for this migration.

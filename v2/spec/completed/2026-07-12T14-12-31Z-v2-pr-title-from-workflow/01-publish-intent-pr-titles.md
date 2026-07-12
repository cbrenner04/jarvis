# Publish intent PR titles

## Problem

Intent and reviewed-intent runs need a stable title through landing and retry.

## Decisions

- File seeds use the seed filename stem as `<name>`, ahead of frontmatter or H1 candidates — rules out agent-authored content changing the title.
- Inline seeds use the generated workflow identity slug as `<name>`, ahead of frontmatter or H1 candidates — rules out an ambiguous first heading or arbitrary prose candidate.
- `--seed` and `--seed-text` remain mutually exclusive, so no candidate precedence exists — rules out silently selecting one input.
- Intent and reviewed-intent publication retain `intent: <name>` in durable retry state — rules out recomputing after staged output has moved or changed.

## Scope

- Supply `intent: <name>` for file and inline intent runs.
- Preserve that title through ordinary and reviewed-intent landing, completion publication, and completed-run retry.
- Cover file and inline inputs, reviewed landing, and retry.

## Acceptance criteria

- [x] A newly created file-seed intent PR is titled `intent: <seed filename stem>`.
- [x] A newly created inline-seed intent PR is titled `intent: <workflow identity slug>`.
- [x] A newly created reviewed-intent PR keeps its intent title after reviewed output lands.
- [x] Retrying completed intent or reviewed-intent publication uses its original intent title when the original staged subject is no longer available.
- [x] Focused workflow-runner and intent-workflow automated tests cover file seed, inline seed, reviewed landing, and durable retry.

## Documentation updates

- None; operator-facing completion semantics are documented with the plan slice.

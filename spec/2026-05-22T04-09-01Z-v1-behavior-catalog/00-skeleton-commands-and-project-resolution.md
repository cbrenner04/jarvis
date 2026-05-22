# 00 — Skeleton, commands, and project resolution

## Problem

`v2/spec/v1-behaviors.md` does not exist yet. The first slice needs to create
the catalog skeleton and cover the broadest user-facing entry points so later
subspecs can fill in the remaining sections without changing the document's
shape.

This slice must also anchor the catalog in current reality: v1 already lives
under `v1/`, but the binary rename to `jarvis1` has not landed. The catalog
must document the shipped command name (`jarvis`) and explicitly note the
pending rename in the Overview section.

## Scope

Create `v2/spec/v1-behaviors.md` from scratch and fully author these sections:

- Overview and scope
- Commands and modes
- Spec authoring and implementation workflows
- Config and project resolution

Create the remaining section headers with placeholder-free stubs that later
subspecs can fill in:

- Agent adapters, model selection, and quota fallback
- Git/GitHub behavior
- Filesystem, logging, telemetry, and other side effects
- Completion, blockers, exit codes, and failure handling
- Behaviors with uncertain intent
- Surprising or possibly vestigial behaviors
- Maintenance requirement for future v1 changes

This subspec also establishes the catalog's shared writing contract so later
subspecs append compatible entries instead of redefining the format. The
initial file should lock the top-level section order from the intent and define
the subsection skeleton that later slices will fill.

## Primary sources

- `v1/src/cli.ts`
- `v1/src/commands/`
- `v1/src/config.ts`
- `v1/src/disambiguation-prompt.ts`
- `v1/src/resolve-project.ts`
- `v1/src/repo.ts`
- `v1/src/repo-url.ts`
- `v1/docs/config.md`
- `v1/docs/run-loop.md`
- `v1/docs/spec-guidance.md`
- `v1/docs/workflows.md`

## Task checklist

- [ ] Create `v2/spec/v1-behaviors.md` with the full target section structure
      and a short preamble that frames the file as a v1 behavior inventory for
      v2 parity review.
- [ ] Establish a stable document contract for later subspecs:
      each behavior is a short bullet, each bullet ends with a `Sources:`
      citation, and only `[uncertain]` is used as an inline status tag when the
      source does not justify a stronger statement.
- [ ] In `## Overview and scope`, document that the catalog describes behavior
      as shipped today under `v1/`, invoked as `jarvis`, and note that the
      planned `jarvis1` rename is pending.
- [ ] Audit `v1/src/cli.ts` and `v1/src/commands/` source-first, then catalog
      every command in the shipped CLI surface:
      `run`, `init`, `config`, `log-server`, `cleanup`, `triage`,
      `review-feedback`, `plan`, `prices`, and `help`.
- [ ] Capture command-specific asymmetries the source exposes, including:
      `review-feedback` requiring `<worktree-name>`, `triage` not requiring it,
      and `prices` being a two-operation command family rather than one flat
      action.
- [ ] Document the non-plan command workflows users observe around spec
      authoring and implementation, including the merge-first rule for specs and
      the expectation that `jarvis run` executes from an index-routed spec tree.
- [ ] Inside `## Commands and modes`, create the long-lived subsection
      structure that later subspecs must keep:
      `### Command surface`, `### Patch-mode run workflow`, and
      `### Plan mode`.
- [ ] Audit config and project resolution behavior from source, including
      registry bootstrap, `--repo`/`repo:`/spec-path resolution order,
      disambiguation prompting, ad-hoc git checkout fallback, and the
      normalization/loose matching behavior around repo URLs and slugs.
- [ ] Inside `## Config and project resolution`, create a stable subsection
      shape that separates config storage/bootstrap from repo resolution and
      ambiguity handling so later edits do not need to reshuffle this section.
- [ ] For every top-level section not yet authored in this subspec, add a brief
      non-placeholder stub sentence that names the later subspec expected to
      fill it. Subspec 05 will remove these stubs once the catalog is complete.
- [ ] Where the source shows silent or surprising resolution behavior, record it
      in the catalog rather than smoothing it over. Use `[uncertain]` only when
      the observable behavior or intended policy cannot be stated confidently
      from source.

## Acceptance criteria

- [ ] `v2/spec/v1-behaviors.md` exists and contains all intended top-level
      section headers from the intent, with substantive content in `Overview and
      scope`, `Commands and modes`, `Spec authoring and implementation
      workflows`, and `Config and project resolution`.
- [ ] The new catalog establishes a stable authoring format for later slices:
      short bullets for behavior entries, trailing `Sources:` citations on each
      entry, and only `[uncertain]` as an inline ambiguity tag.
- [ ] The `Overview and scope` section explicitly says the catalog documents v1
      as currently invoked via `jarvis` and notes the pending `jarvis1` rename.
- [ ] The `Commands and modes` section includes all nine subcommands plus
      `help`, and it distinguishes the `prices` sub-operations and the
      `review-feedback` versus `triage` worktree-argument behavior, while
      reserving a dedicated `### Plan mode` subsection for subspec 03.
- [ ] The `Config and project resolution` section describes the resolution order
      and user-facing ambiguity handling sourced from `v1/src/repo.ts`,
      `v1/src/resolve-project.ts`, `v1/src/disambiguation-prompt.ts`, and
      `v1/src/repo-url.ts`.
- [ ] Every behavior entry added by this subspec cites at least one supporting
      source file.
- [ ] Any ambiguity called out by this subspec is tagged `[uncertain]` and
      includes a brief explanation of what source gap or contradiction remains.

## Documentation updates

- [ ] `v2/spec/v1-behaviors.md` is created and populated for the sections owned
      by this subspec.

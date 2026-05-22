# 03 — Plan mode behavior catalog

## Problem

Plan mode is a large, user-facing workflow with its own prompts, phases,
resume modes, quota handling, and PR lifecycle. The catalog needs a dedicated
slice so those behaviors are audited from source rather than compressed into a
few bullets under general command help.

## Scope

Expand the catalog's treatment of `plan` so a reader can understand the
end-to-end observable workflow and command surface. This may be implemented as
a dedicated plan-mode subsection within `## Commands and modes` or as a
separate top-level section if that produces a clearer catalog, but whichever
shape is chosen must remain grouped by behavior area and preserve the section
structure introduced in subspec 00.

This subspec may also update `## Git/GitHub behavior` if plan-mode source
reveals additional PR-facing details that were not visible in subspec 02, but
the primary owned output is the plan-mode behavior area itself.

## Primary sources

- `v1/src/commands/plan.ts`
- `v1/src/modes/plan/`
- `v1/src/modes/plan/prompts/`
- `v1/src/modes/plan/inline-draft.ts`
- `v1/src/modes/plan/emit-plan-quota-stderr.ts`
- `v1/docs/plan-mode.md`

## Task checklist

- [ ] Audit the complete user-facing plan workflow from source: intent input,
      refine passes, draft generation, review passes, resume flows, stopping
      conditions, and emitted artifacts.
- [ ] Catalog the full plan flag surface from `v1/src/cli.ts` and
      `v1/src/commands/plan.ts`: `--refine-turns`, `--review-passes`, `--repo`,
      `--cwd`, `--resume`, and `--resume-draft`, including the distinction
      between resuming from `index.md` versus `intent.md`.
- [ ] Document how plan prompts and inline-draft behavior shape what the agent
      is asked to produce, but keep the catalog at the level of user-observable
      behavior rather than prompt internals.
- [ ] Capture plan-mode-specific quota and stderr behavior when it differs from
      general patch-mode fallback behavior.
- [ ] Record any additional plan-specific PR or commit behavior that should be
      cross-linked from the Git/GitHub section.
- [ ] Use `[uncertain]` only where source cannot establish the intended
      observable behavior confidently.

## Acceptance criteria

- [ ] `v2/spec/v1-behaviors.md` contains a substantive plan-mode behavior area
      that explains the end-to-end workflow and resume semantics from source.
- [ ] The plan-mode catalog explicitly includes all six plan flags and
      distinguishes `--resume` from `--resume-draft`.
- [ ] The plan-mode catalog captures observable phase behavior, emitted files,
      review/refine loop semantics, and plan-specific quota or stderr output
      where source exposes them.
- [ ] Every behavior entry added by this subspec cites at least one supporting
      source file.
- [ ] Any ambiguity called out by this subspec is tagged `[uncertain]` and
      includes a brief explanation of the unresolved evidence gap.

## Documentation updates

- [ ] `v2/spec/v1-behaviors.md` is updated for the plan-mode behavior area owned
      by this subspec.

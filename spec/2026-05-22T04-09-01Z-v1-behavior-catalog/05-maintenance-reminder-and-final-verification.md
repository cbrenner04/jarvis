# 05 — Maintenance rule, reminder docs, and final verification

## Problem

The catalog is only useful if it stays current while v1 remains active during
the v2 build-out. The last slice needs to encode that maintenance obligation in
the catalog itself, add a nearby reminder where future v1 work is likely to see
it, and verify that the assembled document is structurally complete rather than
an accumulation of partial notes.

## Scope

Fully author the `## Maintenance requirement for future v1 changes` section in
`v2/spec/v1-behaviors.md`.

Add one maintenance reminder outside the catalog in a nearby v1/v2 planning doc
or agent-facing guidance file, choosing the location that best fits the
existing documentation structure after inspecting the current repo state.

Perform a full-document verification pass on `v2/spec/v1-behaviors.md` and
fix any remaining structural issues, missing citations, or leftover placeholder
language introduced by earlier subspecs.

## Primary sources

- `v2/spec/v1-behaviors.md`
- `CLAUDE.md` and/or the most relevant nearby v2 planning doc discovered during
  implementation
- The active spec tree in `spec/2026-05-22T04-09-01Z-v1-behavior-catalog/`

## Task checklist

- [ ] Add a maintenance section to `v2/spec/v1-behaviors.md` stating that any
      v1 bug fix or user-observable behavior change must update the catalog when
      parity-relevant behavior changes.
- [ ] Add a concise reminder in the most relevant adjacent doc or agent-facing
      guidance location so future v1 changes are likely to see the obligation.
- [ ] Review the entire catalog for structural completeness: all intended
      sections present, no placeholder text, no empty stubs, and no missing
      command/agent/behavior areas promised by the intent.
- [ ] Review the catalog for citation completeness and ensure ambiguous entries
      are tagged `[uncertain]` with brief explanations rather than left implicit.
- [ ] Make only corrective edits during this verification pass; do not broaden
      scope beyond keeping the catalog accurate, complete, and reviewable.

## Acceptance criteria

- [ ] `v2/spec/v1-behaviors.md` contains a substantive `## Maintenance
      requirement for future v1 changes` section that states the update rule for
      future v1 behavior changes.
- [ ] At least one adjacent v1/v2 planning or agent-guidance document is updated
      with a concise reminder to keep `v2/spec/v1-behaviors.md` in sync with
      user-observable v1 behavior changes.
- [ ] The final catalog contains all intended behavior-area sections with no
      placeholder text or empty stubs remaining.
- [ ] The final catalog covers the complete CLI command surface and all five
      agent adapters, and all catalog entries have source citations.
- [ ] Any remaining ambiguity in the final catalog is explicitly tagged
      `[uncertain]` with a brief explanation.

## Documentation updates

- [ ] `v2/spec/v1-behaviors.md` gains the maintenance section and any final
      corrective edits needed for a clean reviewable document.
- [ ] One adjacent planning or agent-guidance doc is updated with the
      maintenance reminder.

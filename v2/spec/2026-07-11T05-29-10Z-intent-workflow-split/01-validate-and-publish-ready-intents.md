# Validate and publish ready intents

Turn a completed split step's staged Markdown into an all-or-nothing durable ready-intent set, then use the existing completion publication path.

## Decisions

- Port v1 filename, frontmatter `name:`, exact `## Prerequisites`, and repair rules into shared reusable intent-stage helpers; rule out trusting staged model output or maintaining divergent v1/v2 validators.
- Permit only flat `.md` files named by unique kebab-case slugs without ordering prefixes or `index`; rule out subdirectories, non-Markdown artifacts, duplicate names, and reserved spec-routing output.
- Repair missing/mismatched frontmatter names, missing exact prerequisites sections, exact-heading spacing, line-start issue references, and Markdown lint autofixes as v1 does; rule out repairing malformed prerequisite prose or near-miss headings into authored content.
- Validate the entire staged set and destination collisions before landing any file; rule out partial durable output on one invalid intent.
- Land valid files only under resolved `<targetDir>/ready-intents/` before the existing completion committer/publisher runs; rule out publishing the staging directory as the durable contract.
- Keep successful git publication as a draft PR; rule out v1 intent mode's automatic ready transition.
- A one-behavior seed may emit one file; rule out a minimum fan-out count above one.

## Task checklist

- Extract or port v1 stage repair and validation behind a shared contract used by both workflows without changing v1 behavior.
- Add the intent workflow completion hook that validates, collision-checks, and atomically lands staged files.
- Connect valid landing to the existing completion commit and draft-PR publisher; prevent commit/push/PR work on validation failure.
- Cover valid single/multiple files, repairable drift, structural/content failures, collisions, atomicity, and publication ordering.

## Acceptance criteria

- [ ] Valid staged files land under resolved `<targetDir>/ready-intents/` with matching kebab-case filenames/frontmatter names and an exact `## Prerequisites` section.
- [ ] Repairable drift receives the same deterministic corrections as v1 before validation and landing.
- [ ] Malformed prerequisites, invalid names/layout, empty output, duplicate names, or destination collisions fail without landing any ready intent or invoking commit/push/PR publication.
- [ ] A seed describing one independently observable behavior can complete with exactly one ready-intent file.
- [ ] Successful git-enabled completion lands all valid files, creates the completion commit, pushes `intent/<slug>`, and opens or reuses a draft PR through the existing completion publisher.
- [ ] Publication starts only after the complete staged set is valid and durably landed.
- [ ] Existing v1 intent repair/validation tests stay green (behavior unchanged by sharing the helpers).
- [ ] `v2/docs/first-workflow-walkthrough.md` documents both seed forms, target override and ready-intent destination, branch/worktree behavior, single-intent output, validation failure atomicity, and draft-PR result.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — add the split-only operator happy path and failure/publication outcomes; cross-link the runner contract.

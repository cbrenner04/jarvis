---
name: restore-useful-pr-descriptions
---

# Restore useful PR descriptions

Patch-mode PR bodies regressed to "basically empty" — often just the title,
marker scaffolding, and attribution. Fix it by giving the generated body a fixed
shape instead of an open-ended narrative.

## Body shape

```text
<Description - short and sweet but enough to describe the work>

Decisions:
<unordered list>

<Attributions>
```

- **Description** — a short machine-authored summary of what the work does.
  Enough for a reviewer to understand the change without reading the diff; not a
  spec dump.
- **Decisions** — an unordered list of the notable decisions made in the work.
- **Attributions** — the existing attribution footer, unchanged.

## Scope

- Implement this three-part body in the patch-mode PR generator/update path
  (`v1/src/pr.ts`, `v1/src/modes/patch/pr.ts`, `v1/src/modes/patch/run.ts`).
- Replace the current near-empty default; the Description + Decisions block is
  the generated middle.
- Preserve human edits inside the existing `jarvis:narrative` markers.
- Patch mode only.
- Update the PR-body docs to match.

## Open questions to resolve while drafting

- Source for **Description** (e.g. checked subspec headings in the spec tree vs.
  a small summary builder) — keep it deterministic, not brittle prose synthesis.
- Source for the **Decisions** list (e.g. the spec's recorded decisions /
  refinement ledger). If there are none, render an empty/omitted Decisions
  section rather than a placeholder.
- How the fixed shape coexists with the `jarvis:narrative` markers on rewrites.

## Acceptance criteria

- A new patch-mode PR body has the three parts: a non-empty Description, a
  `Decisions:` unordered list, and the attribution footer — not just title,
  markers, and attribution.
- Rewriting an existing patch-mode PR body after later subspec commits preserves
  human-written narrative inside the `jarvis:narrative` markers while keeping the
  generated Description/Decisions when no human narrative exists.
- Automated tests cover the regression path that yields near-empty bodies and
  verify the three-part shape.
- PR-body docs match shipped behavior: what's generated, what's preserved, and
  where human edits live.

## Out of scope

- Plan-mode PR descriptions — patch mode only here.
- Reverting terse-body work / restoring long checklist or progress dumps.
- Changing draft creation, ready transitions, or attribution trailers beyond
  the body shape.

## Refinement

- Body shape is fixed: Description, `Decisions:` unordered list, Attributions; this supersedes the prior open-ended "what should the narrative contain" framing.
- Description default derives from the checked subspec headings in the current spec tree, deterministically — not commit subjects/trailers or free-form prose, and never summarizing future unchecked work.
- This subspec fixes patch-mode PR bodies only; do not redesign plan-mode PR descriptions here, because bundling both modes would turn one regression fix into a broader product rewrite.
- Deferred to first consumer: whether removing `jarvis:narrative` markers should be treated as an intentional opt-out or auto-repaired with a regenerated machine summary — pin when a caller needs it.

## Blocker

Review and approve `v2/spec/2026-06-01T16-19-02Z-restore-useful-pr-descriptions/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis1 plan --resume-draft v2/spec/2026-06-01T16-19-02Z-restore-useful-pr-descriptions/intent.md`

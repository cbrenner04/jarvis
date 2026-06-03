---
name: restore-useful-pr-descriptions
---

# Restore useful PR descriptions

Jarvis-generated PR bodies regressed to "basically empty" — often just the
title, marker scaffolding, and attribution. This is not patch-mode-specific: all
modes should produce a useful body. Fix it with a **single shared PR-description
prompt fragment** that every mode inherits, asking the agent to author a short
Description and a Decisions list. Attributions stay as-is.

## Prompt shape

The shared fragment asks the model for exactly this, and nothing more:

```text
<Description - short and sweet but enough to describe the work>

Decisions:
<unordered list>
```

- **Description** — the model decides what's appropriate: a short, useful
  summary of the work. Not a spec dump.
- **Decisions** — an unordered list of the notable decisions; the model decides
  what belongs.
- Keep the prompt **really lean**. We refine wording later as we see fit.
- **Attributions** are *not* part of the prompt. The existing attribution footer
  is appended as-is by the current mechanism, unchanged.

## Scope

- Add one shared PR-description prompt fragment that all modes inherit, so every
  mode produces the same body shape from the same source. Per-mode prompt tweaks
  can come later, but they inherit this one fragment.
- Wire each mode's PR-body generation (patch and plan) to use the shared
  fragment; the model authors Description + Decisions.
- Keep appending the existing attribution footer as-is.
- Preserve human edits inside the existing `jarvis:narrative` markers.
- Update the PR-body docs to match.

## Open questions to resolve while drafting

- Where the shared fragment lives and how each mode inherits it.
- How the model-authored body coexists with the `jarvis:narrative` markers on
  rewrites.

## Acceptance criteria

- All modes produce a PR body whose middle is a model-authored Description and
  Decisions list, sourced from the shared prompt fragment — not just title,
  markers, and attribution.
- The shared fragment is lean and asks only for Description + Decisions; the
  attribution footer is appended unchanged, outside the prompt.
- Rewriting a PR body preserves human-written narrative inside the
  `jarvis:narrative` markers while keeping the generated body when no human
  narrative exists.
- Automated tests cover the regression path that yields near-empty bodies and
  verify the shared-fragment body shape across modes.
- PR-body docs match shipped behavior: what's generated, what's preserved, and
  where human edits live.

## Out of scope

- Reverting terse-body work / restoring long checklist or progress dumps.
- Changing draft creation, ready transitions, or the attribution mechanism
  itself.

## Refinement

- One shared, lean PR-description prompt fragment is inherited by all modes; this supersedes the prior patch-mode-only, fixed-template framing.
- The prompt asks the model only for a Description and a `Decisions:` unordered list; the model decides what content is appropriate — not deterministic derivation from subspec headings or commit metadata.
- The model-authored Description + Decisions replace the current narrative payload inside `jarvis:narrative` markers; do not introduce a second generated section outside the markers, because rewrites already preserve only marker contents.
- Attributions are appended by the existing footer mechanism, unchanged, and are not part of the prompt.
- Deferred to first consumer: whether removing `jarvis:narrative` markers should be treated as an intentional opt-out or auto-repaired with a regenerated machine summary — pin when a caller needs it.

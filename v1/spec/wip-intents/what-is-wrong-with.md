# Restore useful PR descriptions

PR descriptions have regressed from "too verbose" to "basically empty." The
current terse-body contract in patch mode deliberately removed progress counts
and the full subspec checklist, but what replaced that is often just the title,
marker scaffolding, and attribution. That is not enough context for reviewers.

This needs to turn back into a product behavior question, not a one-off PR
cleanup: what should Jarvis-generated PR bodies say by default, and why are we
currently ending up with almost nothing?

## What looks wrong now

- Patch-mode PR bodies are rebuilt deterministically on each successful subspec
  commit.
- Rewrites preserve only text inside the narrative markers.
- The terse-body change intentionally removed the old verbose checklist/progress
  sections.
- The current generated narrative path appears to fall back to placeholder-level
  content too often, so a newly opened or rewritten PR can end up with no useful
  summary of the work.
- Plan mode also preserves narrative markers but does not author meaningful
  narrative itself, so "there is nothing in them anymore" may not be isolated to
  one mode.

The likely root problem is not "GitHub lost the description." It is that Jarvis
now has a very small deterministic header/footer contract and no strong rule for
producing a short, durable middle summary when humans have not edited the PR
body yet.

## Desired outcome

Jarvis-generated PRs should have short, useful descriptions by default. A fresh
PR should tell a reviewer what changed without dumping the full spec routing
table, and later rewrites should preserve human edits inside the narrative
markers. "Useful" here means a reviewer can open the PR and understand the work
without needing to infer everything from the branch name or commit list.

## Scope

- Trace the current patch-mode PR-body assembly path and identify why generated
  descriptions collapse to near-empty output.
- Decide what the default machine-authored narrative should contain after the
  terse-body change.
- Implement that behavior in the relevant PR-body generator/update path.
- Decide whether plan mode should remain effectively empty by default or should
  also gain a concise generated summary.
- Preserve the existing narrative-marker contract for human edits.
- Update docs so the PR-body contract matches shipped behavior.

## Non-goals

- Reverting all the terse-body work and restoring long checklist dumps.
- Making PR bodies a substitute for durable docs or spec files.
- Changing unrelated PR lifecycle behavior such as draft creation, ready
  transitions, or attribution trailers unless required by the description fix.

## Likely decision points

- Should the default narrative come from the active subspec, from the spec
  index, from recent commit metadata, or from a small explicit summary builder?
- Should patch and plan mode share exactly one PR-summary generator, or do they
  need different defaults because their source artifacts differ?
- What minimum content is required to count as a useful description: problem,
  shipped behavior, verification, affected areas, or some subset of those?
- If there is no good generated summary source, should Jarvis leave a small
  placeholder, or fail more loudly so the absence is visible during development?

## Acceptance criteria

- Opening a new patch-mode implementation PR produces a non-empty description
  with a meaningful machine-authored summary, not only the title, markers, or
  attribution footer.
- Rewriting an existing patch-mode PR body after later subspec commits preserves
  human-written narrative inside the `jarvis:narrative` markers while still
  keeping a useful default summary when no human narrative exists.
- If plan mode is in scope for the chosen fix, a newly opened plan PR also gets
  a useful default description; if it is intentionally left out of scope, docs
  and tests make that boundary explicit.
- Automated tests cover the regression path that currently yields near-empty PR
  descriptions and verify the new default body shape.
- Documentation describing Jarvis PR bodies matches the shipped behavior and
  explains what content is generated, what content is preserved, and where human
  edits are expected to live.

## Notes for drafting

- Start from the real current contract in `v1/src/pr.ts`,
  `v1/src/modes/patch/pr.ts`, `v1/src/modes/patch/run.ts`, and the PR lifecycle
  docs rather than from memory.
- The finished behavior should stay terse. The bug is missing reviewer context,
  not insufficient bulk.
- Prefer deterministic summary content over brittle prose synthesis.

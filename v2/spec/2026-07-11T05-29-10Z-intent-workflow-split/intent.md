---
name: intent-workflow-split
---

# Split a seed into ready intents

Add the v2-native `intent` workflow. From a registered project checkout, an
operator supplies `--seed <path>` or `--seed-text <text>` plus optional
`--target-dir`; Jarvis runs the shared intent-split prompt in one plan-role
write step, validates and deterministically repairs its staged Markdown, then
lands valid files under `<targetDir>/ready-intents/`.

With git publication enabled, completion uses the existing write-workflow path
to commit the ready intents and open a draft PR from `intent/<slug>` in a
Jarvis-owned worktree under `~/.jarvis/worktrees`. Invalid output must not be
published.

## Decisions

- Preset name is `intent` with one `write` step and no review step — rules out folding the later reviewed workflow into this behavior.
- The step uses `role: plan` and `promptId: intent.prompt.split` — rules out forking v1 split prose into a v2-only prompt.
- Port v1 deterministic checks and repair for frontmatter `name:`, `## Prerequisites`, and filename/name slug agreement — rules out trusting model output as the artifact contract.
- A seed describing one independently observable behavior emits one ready intent — rules out forced fan-out by implementation layer.
- Support file and inline seed inputs only through explicit flags — rules out natural-language routing in this slice.

## Prerequisites

- The v2 workflow launcher resolves registered preset names, invokes their step builders, and starts the resulting workflow through the daemon.

## Out of scope

- Post-split review or the `intent-reviewed` preset.
- Changes to `jarvis1 intent`.
- Natural-language routing.

## Documentation updates

- Extend `v2/docs/first-workflow-walkthrough.md` with the split-only `intent` happy path, inputs, ready-intent destination, worktree/branch, validation failure, and draft-PR outcome.
- Update `v2/docs/workflow-runner.md` with the `intent` preset and builder contract.

## Acceptance contract

- The workflow launcher accepts the registered `intent` preset and rejects its builder errors before daemon start.
- `--seed` and `--seed-text` produce the same split behavior; `--target-dir` controls the durable `ready-intents/` destination.
- The workflow resolves the project from cwd and uses branch `intent/<slug>` in the Jarvis worktree root.
- The preset contains exactly one plan-role write step using `intent.prompt.split` and the staging-directory artifact contract.
- Valid staged intents have matching kebab-case frontmatter names and filenames plus a `## Prerequisites` section; deterministic repair handles the same repairable drift as v1.
- Unrepairable staged output fails without landing or publishing ready intents.
- Successful git-enabled completion lands the intents, commits them, and opens a draft PR through the existing completion publisher.
- A single-behavior seed can complete with exactly one ready-intent file.

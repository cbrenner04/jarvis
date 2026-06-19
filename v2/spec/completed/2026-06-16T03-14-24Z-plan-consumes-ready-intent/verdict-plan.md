Required refinements:

- Clarify the ready-intent boundary for fresh `plan`: accepted path/location and shape, including whether files must live under `ready-intents/`, whether `## Prerequisites` is mandatory or optional, and how arbitrary markdown, `wip-intents/*.md`, old `intent.md`, inline text, and missing paths are rejected or accepted. This is operator-facing behavior and central to “plan consumes a ready-intent.”

- Cover `modes.plan.commit: false`: no-commit fresh plan must follow the same ready-intent entry contract, copy `intent.md`, reject raw seeds, and run draft/review. State the PR/ready-transition exception when no PR exists. Spec guidance documents no-commit plan artifacts, so behavior must stay aligned.

- Define failure atomicity for missing/invalid `name:` frontmatter: the spec must state whether any provisional state may remain, and must require no final branch/worktree/spec output. This prevents observable partial plan artifacts from an invalid input.

- Decide `--resume-draft` and old in-flight plan behavior: reject with guidance, preserve only for legacy branches, or mark old in-flight branches out of scope. Removing the old handoff without defining the flag/migration path leaves an operator-visible ambiguity.

- Make `01` independently reviewable or merge it into `00`: as written, prompt ownership depends on the collapsed entry flow. Each subspec must be independently testable; if kept separate, it needs clear prerequisite sequencing and testable prompt-surface outcomes independent of runtime flow.

- Decide prompt ownership precisely enough to avoid drift: identify the prompt IDs/files that leave plan and where intent authoring owns them, or explicitly retire them. “Move, share, or retire” permits incompatible outcomes for current behavior.

- Name the active plan prompt surfaces retained after the change, especially spec draft, review roles, review actuator, and PR-description behavior. This avoids accidental deletion of still-required review behavior while removing only intent authoring.

- Add required parity documentation to `01` or state it is fully covered by `00`: prompt/runtime ownership changes existing v1 behavior, so `v2/docs/v1-behaviors.md` must remain aligned unless the subspec is narrowed to documentation-free internals.

- Clarify collapsed telemetry and summaries: define the first fresh-plan phase label and require removed `intent`/`refine` phases not to appear in attempts/summaries. This is observable harness behavior.

- Clarify PR lifecycle timing after collapse: state whether the draft PR opens at the same point in the existing plan contract or at a new point. The old lifecycle was tied to removed phases, so the new contract must be explicit.

- State the copied `intent.md` content contract at the behavioral level: source remains untouched and copied content is unchanged enough to preserve frontmatter, sentinels, and `Prerequisites` prompt context. Do not add traceability or permission requirements unless needed by existing docs/operator workflow.

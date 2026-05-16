# 00 - Patch scope spec contract

Jarvis already tells patch-mode agents to modify only files named by the
spec, but the expected shape is implicit. Local models benefit from a concrete
file-scope section that separates editable files from read-only context. This
subspec defines that authoring contract in docs and plan-mode prompt guidance
only. It does not add parser or runtime behavior.

Clarification for **`jarvis plan`**: Markdown **`## Patch scope`** belongs on
implementation subspecs consumed by **`jarvis run`**. Plan iterations enforce a
separate writable boundary under **`spec/<name>/`** via harness checks — see
[`boundary.ts`](../../src/modes/plan/boundary.ts) — rather than Markdown patch scope.

## Decisions

- Add an optional `## Patch scope` section for each subspec.
- The section may contain these level-3 headings:
  - `### Editable`
  - `### Read-only context`
  - `### Out of scope`
- `Editable` and `Read-only context` list repo-relative paths as Markdown
  bullets.
- `Out of scope` is free-form Markdown guidance for the agent and is not
  parsed by later subspecs.
- Absence of `## Patch scope` remains valid. Existing specs must keep working.
- The index file stays routing-only. Patch scope belongs in numbered
  subspecs because each atomic task has a different file boundary.

Example:

```md
## Patch scope

### Editable

- src/agents/aider.ts
- src/agents/types.ts
- test/agents/aider.test.ts

### Read-only context

- src/agents/opencode.ts
- src/agents/spawn.ts
- docs/agents.md

### Out of scope

- Do not change PR attribution.
- Do not change patch-mode completion detection.
```

## Task checklist

- Update `docs/spec-guidance.md` to document the optional `## Patch scope`
  section, heading names, path expectations, and the index-vs-subspec
  placement decision.
- Update `src/modes/patch/rules.md` so agents know to honor `## Patch scope`
  when present.
- Update plan-mode draft prompt guidance so generated specs are encouraged to
  include `## Patch scope` for implementation-heavy subspecs.
- Keep the guidance explicit that scope is a starting boundary, not a license
  to guess. If the necessary edit falls outside `Editable`, the agent should
  record a blocker or update the active subspec only when the active spec
  authorizes spec edits.

## Acceptance criteria

- [ ] `docs/spec-guidance.md` documents `## Patch scope` as optional and
      subspec-local.
- [ ] `docs/spec-guidance.md` includes an example with `Editable`,
      `Read-only context`, and `Out of scope`.
- [ ] `src/modes/patch/rules.md` instructs patch-mode agents to prefer files
      listed under `Editable` and use `Read-only context` only for inspection.
- [ ] Plan-mode draft prompt guidance asks generated specs to include patch
      scope where useful without making it mandatory.
- [ ] No parser, runtime, config, or agent adapter code is changed in this
      subspec.

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- `docs/spec-guidance.md` is the user-facing documentation update for this
  subspec.

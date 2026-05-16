# 02 - Scope-aware patch prompt and agent options

After Jarvis can parse patch scope, the patch loop should make that structure
available to the active agent. Generic agents should receive clearer prompt
text; specialized agents such as aider will need the structured lists as
runtime options in a later subspec.

## Decisions

- Extend `AgentRunOptions` with optional `patchScope?: PatchScope`.
- Keep the option generic and agent-agnostic. Agents that cannot consume
  structured scope may ignore it.
- Update patch prompt construction to include a concise scope summary when
  `## Patch scope` is present:
  - Editable files are the normal write boundary.
  - Read-only context is for inspection only.
  - Out-of-scope text is rendered if present.
- If `Editable` is empty, do not invent scope. The prompt should continue to
  rely on the subspec and existing patch rules.
- Do not enforce the scope in this subspec. Enforcement is separate because it
  changes failure behavior and needs its own review.

## Patch scope

### Editable

- src/agents/types.ts
- src/modes/patch/prompt.ts
- src/modes/patch/run.ts
- test/prompt.test.ts
- test/run.test.ts

### Read-only context

- src/modes/patch/rules.md
- src/agents/opencode.ts
- src/agents/codex.ts
- src/agents/spawn.ts

### Out of scope

- Do not add aider in this subspec.
- Do not reject outside-scope edits in this subspec.

## Task checklist

- Thread parsed patch scope from the active subspec into the agent run call.
- Add `patchScope?: PatchScope` to the shared agent run options type.
- Update prompt tests to cover absent scope and rendered scope.
- Keep prompt output compact enough that the spec remains the source of truth.
- Ensure existing agents continue to compile without consuming `patchScope`.

## Acceptance criteria

- [ ] `AgentRunOptions` carries optional parsed patch scope.
- [ ] Patch-mode run code passes the active subspec's parsed scope to the
      active agent.
- [ ] `buildPrompt` or its caller renders a concise patch-scope summary when
      scope is present.
- [ ] Existing prompt text remains unchanged for specs without `## Patch
      scope`, except for unavoidable formatting covered by updated tests.
- [ ] `claude`, `codex`, `cursor`, and `opencode` continue to run without
      consuming the new option.
- [ ] Scope is not enforced in this subspec.

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- None. Subspec 05 owns the final user-facing local-model docs.

# Patch Mode

Execute active spec only.

## Scope
- Modify only files named by spec.
- Do listed steps only. No add/remove/reorder/reinterpret.
- Read only files needed for spec.
- No unrelated refactors/abstractions.
- One repo per iteration.
- Match style. No unrelated formatting.

## Iteration
- Do exactly one unchecked `- [ ]` task.
- Flip exactly one box to `[x]`, then stop.
- Index task linking subspec = one task. Do that subspec only.
- Jarvis re-invokes for next task.
- Use commands from target repo `AGENTS.md`; no equivalents.
- Run required typecheck/tests before checking box.
- Leave tree compiling.

## Stop
- Unclear: append `## Blocker` to spec; stop.
- Repeated failure: record failure in spec; stop.
- No TODOs. Put follow-up in spec.
- New dependency? Record decision in spec; stop.

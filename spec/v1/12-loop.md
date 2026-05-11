# 12 — Loop orchestration

Wire 02–11 into the `jarvis run <spec-path>` command — the actual ralph loop.

## Behavior

1. Resolve `<spec-path>` to an absolute path. Error out if it does not exist.
2. Load config. Look up the **target repo root** via `findProjectForPath(specPath)` (spec 02). If no registered project's root is an ancestor of the spec path → exit 1 with: "spec path is not inside any project registered with `jarvis init`."
3. Build the active agent list from `config.agentOrder`.
4. Loop:
   - If `isComplete(specPath)` → exit 0 with a "spec complete" message.
   - Build the prompt via `buildPrompt(specPath)`.
   - Pick the first agent in the active list. Invoke it with `cwd = targetRepoRoot`.
   - On `ok` → next iteration.
   - On `quota` → remove that agent from the active list for the rest of this run; print a notice. If the active list is now empty → exit 2 with an "all agents quota-exhausted" message.
   - On `error` → print stderr; exit 3.
5. SIGINT handler: print "interrupted" and exit 130.

## Tasks

- [ ] `src/commands/run.ts` implementing the above.
- [ ] Iteration boundaries are logged (`iteration N — agent: claude`) to stdout.
- [ ] Tests use fake `Agent` implementations to drive the loop:
  - completes after agent flips an unchecked box (test fixture mutates spec file)
  - falls through claude → codex on `quota`
  - exits 2 when all agents return `quota`
  - exits 3 on `error`
- [ ] No artificial sleep between iterations in v1; the agent invocation itself is the pacing.

## Acceptance criteria

- All loop tests pass.
- `jarvis run` on a target repo with a spec containing only checked items exits 0 immediately.

## Documentation updates

- Add a "How the loop works" section to `README.md` describing the four exit codes (0 complete, 2 quota-exhausted, 3 agent error, 130 interrupted) and the fallback behavior.

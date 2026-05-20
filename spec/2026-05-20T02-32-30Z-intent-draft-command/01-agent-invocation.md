# 01 - Agent invocation and file writing

Implement `src/commands/intent.ts` — the command handler that runs one agent turn to draft an intent file.

## Context

No pipeline, no worktree, no git ops. The command:
1. Parses args via `parseIntentArgs` (from 00).
2. Guards against an existing output file (`existsSync`).
3. Builds a seed string from the invocation mode.
4. Constructs a prompt telling the agent to write the file at the resolved absolute path.
5. Iterates `config.modes.plan.agentOrder`, calling `createAgent` + `agent.run()` for each entry; breaks on `"ok"`, continues on `"quota"`, stops on `"model_config"` or `"error"`.
6. After a successful `"ok"` result, checks `existsSync(out)`. If absent, exits 1 with a named error message.
7. Returns exit code 0 on success.

The agent `cwd` is `dirname(out)` so relative file references in the prompt resolve naturally.

Config is loaded the same way `planCommand` loads it: accept an optional `config` override (for tests) and fall back to `loadConfig(cwd)` otherwise.

### Seed text by mode

| mode | seed |
|------|------|
| `interactive` | `"# Intent\n"` |
| `inline` | `invocation.intentText` |
| `file` | contents of `invocation.intentPath` read from disk |

### Prompt wording

The prompt must:
- Tell the agent it is doing a single-turn rough intent draft.
- Include the resolved absolute output path so the agent knows where to write.
- Instruct the agent to write a raw, unstructured dump — no required headings, no acceptance-criteria scaffolding.
- Include the seed text verbatim.

Example (exact wording is not mandated; keep it short):

```
You are drafting a rough intent file for a software project.

Write a single file at the absolute path: <out>

Start from this seed text and expand it into a raw, unstructured capture of the intent.
No required headings. No acceptance-criteria scaffolding. Just a rough dump the author
will edit by hand.

Seed:
<seed text>
```

### agentOrder fallback chain

Mirror the pattern in `src/modes/plan/draft.ts` (and `refine.ts`): iterate `agentOrder`, on `"quota"` continue to the next entry, on `"model_config"` or `"error"` return immediately with exit code 1. If all entries return `"quota"`, emit a quota-exhausted message and exit 1.

### Error messages (stderr, exit 1)

| condition | message |
|-----------|---------|
| output file already exists | `intent: output file already exists: <out>` |
| agent returns `"ok"` but file not written | `intent: agent completed but did not write <out>` |
| all agents quota-exhausted | `intent: all agents returned quota errors` |
| agent returns `"error"` | `intent: agent error (exit <code>)` |
| agent returns `"model_config"` | `intent: agent model config error` |
| file read fails (mode: "file") | `intent: could not read seed file: <intentPath>` |

## Task checklist

- [ ] Create `src/commands/intent.ts`
  - Export `IntentCommandOptions = { io: Io; args?: readonly string[]; cwd?: string; config?: Config }`
  - Export `async function intentCommand(opts: IntentCommandOptions): Promise<number>`
  - Load config: use `opts.config` if provided, else `await loadConfig(opts.cwd ?? process.cwd())`
  - Parse args via `parseIntentArgs`; on `!ok` write message to stderr and return `exitCode`
  - Resolve `cwd` from invocation; compute `out` from invocation
  - Guard: if `existsSync(out)` emit error and return 1
  - Build seed string (read file for `mode: "file"`, catch read errors)
  - Build prompt string
  - Loop `config.modes.plan.agentOrder`: call `createAgent(entry.agent, entry.model)`, then `agent.run(prompt, { cwd: dirname(out) })`
    - `"ok"` → break
    - `"quota"` → continue
    - `"model_config"` | `"error"` → emit error, return 1
  - After loop: if no `"ok"` result → emit quota-exhausted error, return 1
  - Check `existsSync(out)`; if absent emit named error and return 1
  - Return 0

- [ ] No telemetry wiring — skip entirely

## Acceptance criteria

- [ ] `jarvis intent` (interactive mode) invokes the agent with seed `"# Intent\n"` and writes `intent.md` in the working directory on success
- [ ] `jarvis intent "build a widget"` (inline mode) invokes the agent with the inline text as seed
- [ ] `jarvis intent ./seed.md` (file mode) reads `seed.md` and uses its contents as seed
- [ ] `jarvis intent --out notes.md` writes to `notes.md` instead of `intent.md`
- [ ] Running when `intent.md` already exists exits 1 with `intent: output file already exists: ...`
- [ ] When the agent returns `"ok"` but does not create the file, exits 1 with `intent: agent completed but did not write ...`
- [ ] When all agents return `"quota"`, exits 1 with `intent: all agents returned quota errors`
- [ ] TypeScript compiles without errors (`tsc --noEmit` passes)
- [ ] No git operations are performed (no branch creation, no commits, no worktree)

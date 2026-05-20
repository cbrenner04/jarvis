---
name: intent-draft-command
---

need a command for drafting an intention files. one turn, rough as hell draft.
this could be added to the workflow for an inline prompt
i don't want to introduce structure to intention files. i want the ability to manually create them with whatever info

## Refine turn 1

### Command shape

New top-level command: `jarvis intent [<"inline text">]`. Mirrors the existing `plan` invocation surface:
- No argument → interactive: agent is seeded with `# Intent\n` and does one rough-draft turn.
- Inline text argument → agent drafts from the provided text in a single turn.
- File path argument → reads the file as seed text and drafts from it.

Output is written to `intent.md` in the current working directory by default. An `--out <path>` flag allows overriding the destination.  If the output file already exists, the command errors rather than silently overwriting.

### What the agent does

Single-turn invocation only — no refine/draft/review pipeline. The agent's instruction is minimal: produce a rough, unstructured dump of the intent. No headings imposed, no required sections, no acceptance-criteria scaffolding. The resulting file is a raw capture the user will edit by hand before handing it to `jarvis plan <intent-file>`.

### No git ops

No worktree creation, no commits, no PR, no `--repo` resolution required. This command is purely a file-generation utility. It does not call `enterMode` or `createPlanWorktree`.

### Scope

- New command file: `src/commands/intent.ts`
- New arg parser: `src/commands/intent-args.ts` (following the `plan-args.ts` pattern)
- Registered in `src/cli.ts` alongside existing subcommands
- Reuses `createAgent` from `src/agents/factory.ts` for the single-turn invocation

### Open decisions left to draft phase

- Which agent/model to default to (probably the same plan-mode agent)
- Whether to emit telemetry for cost tracking (follow plan-mode pattern if easy, skip if complex)
- Exact prompt wording for the "rough draft" instruction

## Refine turn 2

### No project resolution

Unlike `plan`, `intent` must not call `enterMode` or require being inside a registered project. It is a pure file-generation utility: read seed text → invoke agent once → write file. The only config it needs is the agent/model selection (same keys the plan-mode refine phase uses).

### Agent invocation pattern

The plan-mode phases (`runRefinePhase`, `runDraftPhase`) all call `createAgent` internally via a shared invocation helper in `src/modes/plan/`. For a single-turn intent draft, the draft phase creates an analogous thin wrapper: build a prompt string from the seed text, call the agent once, capture stdout, write to the output path. No iteration, no blocker detection, no working-tree snapshot needed.

The agent should be resolved from config the same way the refine phase resolves it: `cfg.modes?.plan?.agent` → fallback to `cfg.agent` → fallback to `"claude"`, with the same model resolution.

### `cli.ts` changes

`Subcommand` union gains `"intent"`. `parseArgs` gains a `case "intent"` that returns `{ kind: "intent", rest: string[] }`. `run` dispatches to `intentCommand`. The USAGE string gets a one-line entry. Mirror the `plan` case exactly in structure.

### `intent-args.ts` shape

`IntentInvocation` type with the same three modes (`file`, `inline`, `interactive`) plus a `cwd: string` and `out: string` (resolved absolute path of the destination file, defaulting to `join(cwd, "intent.md")`). Flags: `--out <path>` and `--cwd <path>`. No `--refine-turns`, `--review-passes`, `--repo`, or `--resume`.

### Overwrite guard

Before invoking the agent, check if the resolved output path already exists using `existsSync`. If it does, emit an error and exit 1 without running the agent.

### Telemetry

Skip telemetry for this command to keep the implementation minimal. The agent invocation cost will still appear in the agent's own output; jarvis-side telemetry is not required for a utility this small.

### Interactive mode

When no argument is provided, the agent is seeded with the literal string `"# Intent\n"` (matching `seedIntentFile` interactive behavior in plan mode). The agent expands this into a rough dump. No `$EDITOR` launch — the agent does the drafting.

## Refine turn 3

### Agent writes the file; harness does not capture stdout

Turn 2 described "capture stdout, write to the output path" — that model is wrong. Agents in jarvis (claude, codex, etc.) write files via tool calls (Write/Edit), not stdout. The harness passes a prompt that tells the agent where to write the file; after `agent.run()` returns `{kind: "ok"}`, the harness checks `existsSync(out)`. If the file was not created, emit an error and exit 1. This is the same post-run validation pattern plan mode uses for checking that spec files appeared.

The agent should be invoked with `cwd` set to `dirname(out)` so relative file references in the prompt work naturally. The prompt must include the resolved absolute output path so the agent knows exactly which file to create.

### Use `agentOrder` not a single agent key

Plan mode uses `config.modes.plan.agentOrder` (an `Array<{agent: AgentName, model: string}>`), not a single `cfg.agent` key. The intent command should do the same: iterate `agentOrder`, try each entry in sequence, and fall back on quota exhaustion (same pattern as `runRefineTurn`). This keeps parity and means the intent command automatically benefits from any quota-fallback agents the user has configured.

### Error output on agent success without file

If `agent.run()` returns `{kind: "ok"}` but the output file does not exist, emit:
```
intent: agent completed but did not write <out>
```
and exit 1. This guards against prompts that the agent misinterprets without crashing silently.

# 07 — Agent adapter interface + `claude`

Define the `Agent` interface all adapters implement, and ship the `claude` adapter.

## Interface

```ts
export type AgentName = "claude" | "codex" | "cursor";

export type AgentResult =
  | { kind: "ok"; stdout: string; stderr: string }
  | { kind: "quota"; stderr: string }   // detected per spec 10
  | { kind: "error"; exitCode: number; stderr: string };

export interface Agent {
  name: AgentName;
  /** Send a one-shot prompt; resolve when the underlying CLI exits. */
  run(prompt: string, opts: { cwd: string }): Promise<AgentResult>;
}
```

## Tasks

- [ ] `src/agents/types.ts` — the interface above.
- [ ] `src/agents/claude.ts` — invokes the `claude` CLI in one-shot/non-interactive mode with the prompt on stdin (or via the appropriate flag — pick whichever the current `claude` CLI supports for non-interactive single-prompt runs; document the chosen invocation in the file header).
- [ ] `cwd` is honored so the agent runs in the target repo.
- [ ] Quota detection is **stubbed** here (always returns `ok` or `error`); spec 10 wires in the real detection.
- [ ] Tests: mock `child_process` (or use a fake binary on `PATH` via tempdir) to assert correct argv, stdin handling, and result mapping.

## Acceptance criteria

- Calling `new ClaudeAgent().run("hi", { cwd })` spawns `claude` with the documented argv and resolves with a typed `AgentResult`.

## Documentation updates

- Add an "Agents" section to `README.md` listing supported agents and the CLI each one shells out to.

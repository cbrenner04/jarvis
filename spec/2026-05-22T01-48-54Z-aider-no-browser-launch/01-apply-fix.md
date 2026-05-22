# 01 — Apply the fix: suppress aider browser launches

## Context

This subspec applies the two-part fix identified in the root cause analysis
(subspec 00). The fix is unconditional across all three root cause cases:

- **`--no-show-model-warnings`** in aider's argv — the aider-supported flag that
  suppresses model-warning output and the associated browser open.
- **`BROWSER=false`** in the subprocess env — a belt-and-suspenders guard that
  causes Python's `webbrowser` module to execute `/usr/bin/false` (or shell
  `false`) instead of the OS browser, exiting 1 silently. This survives aider
  version changes or undocumented browser-open code paths.

The implementation requires a small structural extension to `SpawnConfig` in
`src/agents/spawn.ts` so the aider agent can inject env overrides without
affecting other agents.

## Changes

### `src/agents/spawn.ts`

**Interface `SpawnConfig` (lines 9–17):** add an optional `env` field after
`streamErrorPrefix`:

```ts
env?: Record<string, string>;
```

**Line 26 env construction:** change:

```ts
const env = { ...process.env, PWD: config.cwd } as Record<string, string>;
```

to:

```ts
const env = { ...process.env, PWD: config.cwd, ...config.env } as Record<string, string>;
```

`...config.env` goes last so caller overrides win. When `config.env` is
`undefined` the spread is a no-op.

### `src/agents/aider.ts`

**`buildArgv` (lines 57–66):** add `"--no-show-model-warnings"` to the argv
array, after `"--no-stream"`:

```ts
"--no-stream",
"--no-show-model-warnings",
```

**`runAgent` call (the `SpawnConfig` object, ending around line 73):** add the
`env` field:

```ts
streamErrorPrefix: "aider:",
env: { BROWSER: "false" },
```

### `test/agents/aider.test.ts`

**Extend `fakeBinary`** to record the `BROWSER` env var alongside argv and cwd.
Add the following line to the bash script inside `fakeBinary`, after the `pwd`
line:

```bash
printf '%s' "${BROWSER:-__unset__}" > "${dir}/browser_env"
```

The `__unset__` sentinel distinguishes "not passed" from "passed as empty
string" so the test assertion is unambiguous.

**Extend the existing argv test** (`"spawns aider with --message, --model,
--yes-always, --no-auto-commits, --no-git, --no-stream in cwd"`) to also assert
`--no-show-model-warnings` is present in `argv`.

**Add a new test** asserting the `BROWSER` env var reaches the subprocess as
`"false"`:

```ts
test("passes BROWSER=false to the aider subprocess", async () => {
  const bin = fakeBinary({ exit: 0 });
  const agent = new AiderAgent({ binary: bin, model: "ollama/llama3" });
  await agent.run("prompt", { cwd });
  const browserEnv = readFileSync(join(dir, "browser_env"), "utf8");
  expect(browserEnv).toBe("false");
});
```

## Task checklist

- [ ] Add `env?: Record<string, string>` to `SpawnConfig` in `src/agents/spawn.ts`.
- [ ] Spread `config.env` last in the env construction at line 26 of `src/agents/spawn.ts`.
- [ ] Add `"--no-show-model-warnings"` to the argv array in `AiderAgent.buildArgv` in `src/agents/aider.ts`.
- [ ] Add `env: { BROWSER: "false" }` to the `SpawnConfig` object in `AiderAgent.run` in `src/agents/aider.ts`.
- [ ] Extend `fakeBinary` in `test/agents/aider.test.ts` to emit `${BROWSER:-__unset__}` to `${dir}/browser_env`.
- [ ] Extend the existing argv test to assert `--no-show-model-warnings` is in `argv`.
- [ ] Add a new test that reads `${dir}/browser_env` and asserts the value is `"false"`.
- [ ] Run `bun run typecheck` and `bun test` and confirm both pass.

## Acceptance criteria

- [ ] `SpawnConfig` in `src/agents/spawn.ts` has an optional `env?: Record<string, string>` field.
- [ ] The env construction in `runAgent` merges `config.env` after `PWD` so caller values override process env.
- [ ] `"--no-show-model-warnings"` appears in the argv array built by `AiderAgent.buildArgv`.
- [ ] `AiderAgent.run` passes `env: { BROWSER: "false" }` in its `SpawnConfig`.
- [ ] A test in `test/agents/aider.test.ts` asserts `BROWSER=false` is received by the aider subprocess (via the `browser_env` file written by `fakeBinary`).
- [ ] The existing argv test also asserts `--no-show-model-warnings` is present.
- [ ] `bun run typecheck` passes with no new errors.
- [ ] `bun test` passes with no failures.
- [ ] No other agents (claude, codex, cursor, opencode) are affected — they do not pass `env` in their `SpawnConfig`, so their env construction is unchanged.

## Documentation updates

No new documentation required in this subspec. `docs/aider-model-warnings.md`
(created in subspec 00) already documents the rationale for both changes.

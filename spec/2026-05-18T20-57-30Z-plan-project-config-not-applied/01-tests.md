# Add regression tests for both fix paths

## Context

The two bugs fixed in `00-fix-resolve-plan-flags.md` had no dedicated regression coverage. This subspec adds tests so the same breakage cannot be silently reintroduced.

## Tests to add

### `test/config.test.ts` — `findProjectForPath` preserves plan field

Add a test inside the existing `describe("registerProject / findProjectForPath", ...)` block (around line 709) asserting that a project registered with a `plan` field is returned with that field intact:

```ts
test("findProjectForPath returns plan field from registered project", () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-plan-field-"));
  try {
    // Register a project with a plan override via writeConfig, since
    // registerProject only takes root + origin.
    registerProject("planproj", root, { dir });
    const cfg = loadConfig({ dir });
    cfg.projects.planproj!.plan = { specTimestamp: false, commit: false };
    writeConfig(cfg, { dir });

    const result = findProjectForPath(root, { dir });
    expect(result?.plan).toEqual({ specTimestamp: false, commit: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

### `test/plan-command.test.ts` — main path respects project-level plan flags

Add a test that registers a project with `plan: { specTimestamp: false, commit: false }` against global defaults of `true`, runs `planCommand`, and asserts that the agent receives flag values from the project level, not the global defaults.

Use `setupRegisteredProject` as the pattern. After registering, write the full config with project-level plan overrides:

```ts
test("project-level specTimestamp and commit override global defaults", async () => {
  const { dir, cfgDir, project } = setupRegisteredProject();
  // Set global defaults to true, project overrides to false
  const cfg = loadConfig({ dir: cfgDir });
  cfg.modes = { ...cfg.modes, plan: { specTimestamp: true, commit: true } };
  cfg.projects.project!.plan = { specTimestamp: false, commit: false };
  writeConfig(cfg, { dir: cfgDir });

  // Run plan with a minimal mock agent that captures harness log lines
  const { client, harnessTexts } = capturingLogClient();
  const { io } = captureIo();
  const specPath = join(project, "intent.md");
  writeFileSync(specPath, "---\nname: test-plan\n---\ntest intent\n");

  await planCommand(
    parsePlanArgs(["--dry-run", specPath]),   // use whatever dry-run / stub flag exists
    { io, logClient: client, configDir: cfgDir },
  );

  // The harness log should record commit=false and specTimestamp=false
  const flagLine = harnessTexts.find((t) => t.includes("commit="));
  expect(flagLine).toMatch(/commit=false/);
  expect(flagLine).toMatch(/specTimestamp=false/);
});
```

> Note: if `planCommand` does not expose a `--dry-run` flag, use the existing test pattern that stubs the agent runner (look at how other tests in `plan-command.test.ts` assert flag values without running a real agent). Adjust the assertion to whatever surface area `planCommand` exposes for resolved flags — the key invariant is that project-level `false` wins over global `true`.

## Acceptance criteria

- [x] `test/config.test.ts`: a new test within the `registerProject / findProjectForPath` describe block asserts that `findProjectForPath` returns a `Project` with the `plan` field populated when the registered project has one.
- [x] `test/plan-command.test.ts`: a new test asserts that when a project's config has `plan.specTimestamp: false` and `plan.commit: false` and the global `modes.plan` has both as `true`, `planCommand` resolves to the project-level values.
- [x] Both new tests pass (`bun test test/config.test.ts test/plan-command.test.ts`).
- [x] No existing tests are broken.

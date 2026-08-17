import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { captureIo } from "../testing/cli-test-helpers.ts";
import { type InitCommandDeps, MACHINE_PROFILES_DIR, runInitCommand } from "./init.ts";
import {
  evaluateReadiness,
  isReadinessCheckRequired,
  READINESS_CHECK_ORDER,
  type ReadinessContext,
  type ReadinessProbes,
  readinessExitCode,
  renderReadinessReport,
} from "./init-readiness.ts";

type Fixture = {
  root: string;
  projectRoot: string;
  configPath: string;
  machinesDir: string;
};

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): Fixture {
  mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".scratch", "init-machine-"));
  fixtureRoots.push(root);
  const machinesDir = join(root, "machines");
  const projectRoot = join(root, "project");
  mkdirSync(machinesDir);
  mkdirSync(projectRoot);
  for (const name of readdirSync(MACHINE_PROFILES_DIR).filter((entry) => entry.endsWith(".json"))) {
    copyFileSync(join(MACHINE_PROFILES_DIR, name), join(machinesDir, name));
  }
  return { root, projectRoot, configPath: join(root, "config.json"), machinesDir };
}

function deps(
  fx: Fixture,
  runnable: readonly string[],
  writes?: { count: number },
  overrides: Partial<InitCommandDeps> = {},
): InitCommandDeps {
  return {
    machineConfigPath: fx.configPath,
    machinesDir: fx.machinesDir,
    isExecutable: (name) => runnable.includes(name),
    cwd: fx.projectRoot,
    git: (_cwd, args) =>
      args[0] === "rev-parse" ? fx.projectRoot : args[0] === "remote" ? "git@example.test:project.git" : undefined,
    // Bounded readiness probes: hermetic defaults so tests never touch the real gh CLI or daemon.
    checkBunRuntime: async () => ({ ok: true }),
    checkGithubAuth: async () => ({ ok: true }),
    checkDaemon: async () => ({ state: "stopped" }),
    ...(writes === undefined
      ? {}
      : {
          writeConfigAtomically: (path: string, content: string) => {
            writes.count += 1;
            writeFileSync(path, content);
          },
        }),
    ...overrides,
  };
}

async function run(
  fx: Fixture,
  argv: readonly string[],
  runnable: readonly string[],
  writes?: { count: number },
  overrides?: Partial<InitCommandDeps>,
) {
  const cap = captureIo();
  const code = await runInitCommand(argv, cap.io, deps(fx, runnable, writes, overrides));
  return { code, ...cap.read() };
}

function seedConfig(fx: Fixture, value: unknown, raw?: string): string {
  const content = raw ?? `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(fx.configPath, content);
  return content;
}

function registeredProject(fx: Fixture): Record<string, unknown> {
  return { projects: { project: { root: fx.projectRoot, origin: "git@example.test:project.git" } } };
}

function listFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else result.push(relative(root, full));
    }
  };
  if (existsSync(root)) walk(root);
  return result.sort();
}

describe("init machine bootstrap", () => {
  test("fresh init bootstraps a compatible machine idempotently", async () => {
    // @mutate v2/src/commands/init.ts "next.agents = [...agents];" -> ""
    const fx = fixture();

    const first = await run(fx, ["--profile", "home"], ["claude"]);
    expect(first).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(readFileSync(fx.configPath, "utf8"))).toEqual({
      machineProfile: "home",
      agents: ["claude"],
      projects: {
        project: {
          root: fx.projectRoot,
          origin: "git@example.test:project.git",
        },
      },
    });

    const firstBytes = readFileSync(fx.configPath, "utf8");
    const second = await run(fx, ["--profile", "home"], ["claude"]);
    expect(second).toMatchObject({ code: 0, stderr: "" });
    expect(readFileSync(fx.configPath, "utf8")).toBe(firstBytes);
  });

  test("machine bootstrap rejects incompatible or malformed state without mutation", async () => {
    const missingProfile = fixture();
    expect(await run(missingProfile, [], ["claude"])).toEqual({
      code: 1,
      stdout: "",
      stderr: "init: --profile is required; choose one of: home, work\n",
    });
    expect(existsSync(missingProfile.configPath)).toBe(false);

    const conflicting = fixture();
    const conflictingBytes = seedConfig(conflicting, {
      keep: true,
      agents: ["claude"],
      machineProfile: "home",
    });
    expect((await run(conflicting, ["--profile", "work"], ["claude"])).stderr).toBe(
      "init: machine profile 'home' conflicts with --profile 'work'; choose one of: home, work\n",
    );
    expect(readFileSync(conflicting.configPath, "utf8")).toBe(conflictingBytes);

    for (const invalid of ["home.json", "HOME", "../home", "home/../work"]) {
      const unknown = fixture();
      expect((await run(unknown, ["--profile", invalid], ["claude"])).stderr).toBe(
        `init: unknown machine profile '${invalid}'; choose one of: home, work\n`,
      );
      expect(existsSync(unknown.configPath)).toBe(false);
    }

    for (const malformed of [
      { agents: [], machineProfile: "home" },
      { agents: ["claude", "claude"], machineProfile: "home" },
      { agents: [7], machineProfile: "home" },
      { agents: ["claude"], machineProfile: "" },
      { agents: ["claude"], machineProfile: 7 },
    ]) {
      const fx = fixture();
      const before = seedConfig(fx, malformed);
      const result = await run(fx, [], ["claude"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toStartWith("init: Machine config");
      expect(readFileSync(fx.configPath, "utf8")).toBe(before);
    }

    const noneAvailable = fixture();
    expect((await run(noneAvailable, ["--profile", "home"], [])).stderr).toBe(
      "init: no runnable default agent found; tried: claude, codex, cursor\n",
    );
    expect(existsSync(noneAvailable.configPath)).toBe(false);

    const unbound = fixture();
    const unboundBytes = seedConfig(unbound, { agents: ["claude"], machineProfile: "work", keep: true });
    const unboundResult = await run(unbound, [], ["claude"]);
    expect(unboundResult.code).toBe(1);
    expect(unboundResult.stderr).toContain("machine profile 'work' does not bind configured agents");
    expect(readFileSync(unbound.configPath, "utf8")).toBe(unboundBytes);

    const missingCli = fixture();
    const missingCliBytes = seedConfig(missingCli, {
      agents: ["claude", "codex"],
      machineProfile: "home",
      keep: true,
    });
    expect((await run(missingCli, [], ["claude"])).stderr).toBe(
      "init: configured agent 'codex' is not runnable on PATH\n",
    );
    expect(readFileSync(missingCli.configPath, "utf8")).toBe(missingCliBytes);

    const preserved = fixture();
    const preservedBytes = seedConfig(
      preserved,
      {},
      `${JSON.stringify({
        keep: { nested: true },
        agents: ["claude"],
        machineProfile: "home",
        ...registeredProject(preserved),
      })}\n`,
    );
    const writes = { count: 0 };
    expect(await run(preserved, ["--profile", "home"], ["claude"], writes)).toMatchObject({
      code: 0,
      stderr: "",
    });
    expect(writes.count).toBe(0);
    expect(readFileSync(preserved.configPath, "utf8")).toBe(preservedBytes);
  });

  test("profile bindings govern bootstrap and runnable roster", async () => {
    expect(
      readdirSync(MACHINE_PROFILES_DIR)
        .filter((name) => name.endsWith(".json"))
        .sort(),
    ).toEqual(["home.json", "work.json"]);

    for (const agent of ["claude", "codex", "cursor"]) {
      const home = fixture();
      const before = seedConfig(home, {
        agents: [agent],
        machineProfile: "home",
        keep: agent,
        ...registeredProject(home),
      });
      expect((await run(home, [], [agent])).code).toBe(0);
      expect(readFileSync(home.configPath, "utf8")).toBe(before);
    }

    const work = fixture();
    const workBytes = seedConfig(work, {
      agents: ["opencode"],
      machineProfile: "work",
      keep: true,
      ...registeredProject(work),
    });
    expect(await run(work, ["--profile", "work"], ["opencode"])).toMatchObject({ code: 0, stderr: "" });
    expect(readFileSync(work.configPath, "utf8")).toBe(workBytes);

    const freshWork = fixture();
    const freshWorkResult = await run(freshWork, ["--profile", "work"], ["claude", "opencode"]);
    expect(freshWorkResult.code).toBe(1);
    expect(freshWorkResult.stderr).toContain("machine profile 'work' does not bind configured agents");
    expect(existsSync(freshWork.configPath)).toBe(false);
  });

  test("machine bootstrap guard inversions expose unsafe state", async () => {
    // @mutate v2/src/commands/init.ts "entry.isFile() && entry.name.endsWith(\".json\") && entry.name.length > 5" -> "entry.isFile()"
    // @mutate v2/src/commands/init.ts "if (requestedProfile !== undefined && configuredProfile !== undefined && requestedProfile !== configuredProfile) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (Array.isArray((modelConfig as LoadError).errors)) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (!isExecutable(agent)) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (typeof value !== \"string\" || value.length === 0) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (!needsWrite) return undefined;" -> "if (false) return undefined;"
    const enumeration = fixture();
    writeFileSync(join(enumeration.machinesDir, "README"), "not a profile\n");
    expect((await run(enumeration, ["--profile", "missing"], ["claude"])).stderr).toBe(
      "init: unknown machine profile 'missing'; choose one of: home, work\n",
    );

    const conflict = fixture();
    seedConfig(conflict, { agents: ["claude"], machineProfile: "home" });
    expect((await run(conflict, ["--profile", "work"], ["claude"])).stderr).toContain("conflicts with --profile");

    const compatibility = fixture();
    seedConfig(compatibility, { agents: ["claude"], machineProfile: "work" });
    expect((await run(compatibility, [], ["claude"])).stderr).toContain("does not bind configured agents");

    const executable = fixture();
    seedConfig(executable, { agents: ["claude"], machineProfile: "home" });
    expect((await run(executable, [], [])).stderr).toBe("init: configured agent 'claude' is not runnable on PATH\n");

    const malformed = fixture();
    seedConfig(malformed, { agents: ["claude"], machineProfile: 7 });
    expect((await run(malformed, [], ["claude"])).stderr).toBe(
      "init: Machine config 'machineProfile' must be a non-empty string\n",
    );

    const idempotent = fixture();
    seedConfig(idempotent, {
      agents: ["claude"],
      machineProfile: "home",
      ...registeredProject(idempotent),
    });
    const writes = { count: 0 };
    expect((await run(idempotent, [], ["claude"], writes)).code).toBe(0);
    expect(writes.count).toBe(0);
  });
});

describe("init project registration", () => {
  test("project registration is additive and idempotent", async () => {
    // @mutate v2/src/commands/init.ts "nextProject.root = projectRoot;" -> ""
    const named = fixture();
    const writes = { count: 0 };
    expect(
      await run(named, ["--profile", "home", "--name", "demo"], ["claude"], writes, {
        git: (_cwd, args) => (args[0] === "rev-parse" ? named.projectRoot : "git@example.test:demo.git"),
      }),
    ).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(readFileSync(named.configPath, "utf8"))).toEqual({
      machineProfile: "home",
      agents: ["claude"],
      projects: { demo: { root: named.projectRoot, origin: "git@example.test:demo.git" } },
    });
    expect(writes.count).toBe(1);

    const firstBytes = readFileSync(named.configPath, "utf8");
    // Origin drift (stored "demo.git" vs current "changed.git") fails the required readiness origin
    // check without rewriting stored state.
    expect(
      await run(named, [], ["claude"], writes, {
        git: (_cwd, args) => (args[0] === "rev-parse" ? named.projectRoot : "git@example.test:changed.git"),
      }),
    ).toMatchObject({ code: 1, stderr: "" });
    expect(writes.count).toBe(1);
    expect(readFileSync(named.configPath, "utf8")).toBe(firstBytes);

    const noOrigin = fixture();
    // No current origin fails the required readiness origin check even though setup itself does
    // not require one.
    expect(
      await run(noOrigin, ["--profile", "home"], ["claude"], undefined, {
        git: (_cwd, args) => (args[0] === "rev-parse" ? noOrigin.projectRoot : undefined),
      }),
    ).toMatchObject({ code: 1, stderr: "" });
    expect(JSON.parse(readFileSync(noOrigin.configPath, "utf8"))).toEqual({
      machineProfile: "home",
      agents: ["claude"],
      projects: { project: { root: noOrigin.projectRoot } },
    });
  });

  test("project registration merge preserves unrelated config", async () => {
    const fx = fixture();
    const otherRoot = join(fx.root, "other");
    const before = {
      agents: ["claude"],
      machineProfile: "home",
      unrelated: { nested: [1, "two"] },
      projects: {
        other: { root: otherRoot, origin: "keep-other", custom: true },
        demo: { custom: { keep: true }, plan: { targetDir: "v2/spec", extra: 7 } },
      },
    };
    seedConfig(fx, before);

    expect(await run(fx, ["--name", "demo"], ["claude"])).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(readFileSync(fx.configPath, "utf8"))).toEqual({
      ...before,
      projects: {
        ...before.projects,
        demo: {
          ...before.projects.demo,
          root: fx.projectRoot,
          origin: "git@example.test:project.git",
        },
      },
    });
  });

  test("project registration refuses unsafe identity and malformed config", async () => {
    const assertUnchanged = async (
      fx: Fixture,
      argv: readonly string[],
      overrides: Partial<InitCommandDeps>,
      expected: readonly string[],
    ) => {
      const marker = join(fx.projectRoot, "marker.txt");
      writeFileSync(marker, "keep\n");
      const configBytes = readFileSync(fx.configPath, "utf8");
      const result = await run(fx, argv, ["claude"], undefined, overrides);
      expect(result.code).toBe(1);
      for (const value of expected) expect(result.stderr).toContain(value);
      expect(readFileSync(fx.configPath, "utf8")).toBe(configBytes);
      expect(readFileSync(marker, "utf8")).toBe("keep\n");
    };

    const nonGit = fixture();
    seedConfig(nonGit, { agents: ["claude"], machineProfile: "home" });
    await assertUnchanged(nonGit, [], { git: () => undefined }, [nonGit.projectRoot, "not a Git worktree"]);

    const nested = fixture();
    const nestedCwd = join(nested.projectRoot, "subdirectory");
    mkdirSync(nestedCwd);
    seedConfig(nested, { agents: ["claude"], machineProfile: "home" });
    await assertUnchanged(
      nested,
      [],
      { cwd: nestedCwd, git: (_cwd, args) => (args[0] === "rev-parse" ? nested.projectRoot : undefined) },
      [nestedCwd, nested.projectRoot],
    );

    for (const name of ["bad/name", ".", "../demo", "_demo"]) {
      const unsafe = fixture();
      seedConfig(unsafe, { agents: ["claude"], machineProfile: "home" });
      await assertUnchanged(unsafe, ["--name", name], {}, [name, "must match"]);
    }

    const keyConflict = fixture();
    const otherRoot = join(keyConflict.root, "other");
    seedConfig(keyConflict, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { demo: { root: otherRoot } },
    });
    await assertUnchanged(keyConflict, ["--name", "demo"], {}, [otherRoot, keyConflict.projectRoot]);

    const duplicate = fixture();
    seedConfig(duplicate, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { existing: { root: duplicate.projectRoot } },
    });
    await assertUnchanged(duplicate, ["--name", "different"], {}, ["existing", "different"]);

    const malformedValues: unknown[] = [
      [],
      { demo: [] },
      { demo: { root: 7 } },
      { demo: { origin: 7 } },
      { demo: { plan: [] } },
      { demo: { plan: { targetDir: 7 } } },
    ];
    for (const projects of malformedValues) {
      const malformed = fixture();
      seedConfig(malformed, { agents: ["claude"], machineProfile: "home", projects });
      await assertUnchanged(malformed, ["--name", "demo"], {}, ["Machine config 'projects"]);
    }
  });

  test("project registration guard inversions expose unsafe mutation", async () => {
    // @mutate v2/src/commands/init.ts "if (resolvedCwd !== projectRoot) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (projectKey === undefined || !PROJECT_KEY_PATTERN.test(projectKey)) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (existingRootKeys.some((key) => key !== projectKey)) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (storedRoot !== undefined && resolve(storedRoot as string) !== projectRoot) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (nextProject.origin === undefined) {" -> "if (true) {"
    // @mutate v2/src/commands/init.ts "if (existingProject !== undefined) validateProjectEntry(projectKey, existingProject);" -> ""
    // @mutate v2/src/commands/init.ts "const nextProject = { ...(existingProject ?? {}) };" -> "const nextProject: Record<string, unknown> = {};"
    const nested = fixture();
    const nestedCwd = join(nested.projectRoot, "nested");
    mkdirSync(nestedCwd);
    seedConfig(nested, { agents: ["claude"], machineProfile: "home" });
    expect(
      (
        await run(nested, [], ["claude"], undefined, {
          cwd: nestedCwd,
          git: (_cwd, args) => (args[0] === "rev-parse" ? nested.projectRoot : undefined),
        })
      ).code,
    ).toBe(1);

    const unsafe = fixture();
    seedConfig(unsafe, { agents: ["claude"], machineProfile: "home" });
    expect((await run(unsafe, ["--name", "bad/name"], ["claude"])).code).toBe(1);

    const duplicate = fixture();
    seedConfig(duplicate, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { existing: { root: duplicate.projectRoot } },
    });
    expect((await run(duplicate, ["--name", "different"], ["claude"])).code).toBe(1);

    const conflict = fixture();
    seedConfig(conflict, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { demo: { root: join(conflict.root, "other") } },
    });
    expect((await run(conflict, ["--name", "demo"], ["claude"])).code).toBe(1);

    const origin = fixture();
    const originBytes = seedConfig(origin, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { project: { root: origin.projectRoot, origin: "stored" } },
    });
    expect(
      await run(origin, [], ["claude"], undefined, {
        git: (_cwd, args) => (args[0] === "rev-parse" ? origin.projectRoot : "changed"),
      }),
    ).toMatchObject({ code: 1, stderr: "" });
    expect(readFileSync(origin.configPath, "utf8")).toBe(originBytes);

    const malformed = fixture();
    seedConfig(malformed, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { project: { root: malformed.projectRoot, origin: 7 } },
    });
    expect((await run(malformed, [], ["claude"])).code).toBe(1);

    const preserved = fixture();
    const preservedBytes = seedConfig(preserved, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { project: { root: preserved.projectRoot, origin: "stored", keep: true } },
    });
    // Stored origin "stored" does not match the fixture's mocked current origin, so readiness's
    // required origin check fails even though config bytes are untouched.
    expect((await run(preserved, [], ["claude"])).code).toBe(1);
    expect(readFileSync(preserved.configPath, "utf8")).toBe(preservedBytes);
  });
});

describe("init planning directory", () => {
  test("scaffold writes only contained queue sentinels", async () => {
    // @mutate v2/src/commands/init.ts "writeQueueSentinel(path);" -> ""
    const fx = fixture();
    seedConfig(fx, { agents: ["claude"], machineProfile: "home", ...registeredProject(fx) });

    const result = await run(fx, ["--target-dir", "v2/spec", "--scaffold"], ["claude"]);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(readFileSync(fx.configPath, "utf8")).projects.project.plan).toEqual({ targetDir: "v2/spec" });
    expect(readFileSync(join(fx.projectRoot, "v2/spec/seeds/.gitkeep"), "utf8")).toBe("");
    expect(readFileSync(join(fx.projectRoot, "v2/spec/ready-intents/.gitkeep"), "utf8")).toBe("");
    expect(listFiles(fx.projectRoot)).toEqual(["v2/spec/ready-intents/.gitkeep", "v2/spec/seeds/.gitkeep"]);

    const withoutScaffold = fixture();
    seedConfig(withoutScaffold, { agents: ["claude"], machineProfile: "home", ...registeredProject(withoutScaffold) });
    expect(await run(withoutScaffold, ["--target-dir", "v2/spec"], ["claude"])).toMatchObject({
      code: 0,
      stderr: "",
    });
    expect(listFiles(withoutScaffold.projectRoot)).toEqual([]);
    expect(JSON.parse(readFileSync(withoutScaffold.configPath, "utf8")).projects.project.plan).toEqual({
      targetDir: "v2/spec",
    });
  });

  test("init target directory precedence matches workflow routing", async () => {
    const explicitWins = fixture();
    seedConfig(explicitWins, {
      agents: ["claude"],
      machineProfile: "home",
      modes: { plan: { targetDir: "legacy/spec" } },
      projects: {
        project: {
          root: explicitWins.projectRoot,
          origin: "git@example.test:project.git",
          plan: { targetDir: "owned/spec" },
        },
      },
    });
    expect(await run(explicitWins, ["--target-dir", "explicit/spec", "--scaffold"], ["claude"])).toMatchObject({
      code: 0,
      stderr: "",
    });
    expect(existsSync(join(explicitWins.projectRoot, "explicit/spec/seeds/.gitkeep"))).toBe(true);
    expect(JSON.parse(readFileSync(explicitWins.configPath, "utf8")).projects.project.plan.targetDir).toBe(
      "explicit/spec",
    );

    const ownedWins = fixture();
    const ownedBytes = seedConfig(ownedWins, {
      agents: ["claude"],
      machineProfile: "home",
      modes: { plan: { targetDir: "legacy/spec" } },
      projects: {
        project: {
          root: ownedWins.projectRoot,
          origin: "git@example.test:project.git",
          plan: { targetDir: "owned/spec" },
        },
      },
    });
    expect(await run(ownedWins, ["--scaffold"], ["claude"])).toMatchObject({ code: 0, stderr: "" });
    expect(existsSync(join(ownedWins.projectRoot, "owned/spec/seeds/.gitkeep"))).toBe(true);
    expect(readFileSync(ownedWins.configPath, "utf8")).toBe(ownedBytes);

    const legacyWins = fixture();
    const legacyBytes = seedConfig(legacyWins, {
      agents: ["claude"],
      machineProfile: "home",
      modes: { plan: { targetDir: "legacy/spec" } },
      ...registeredProject(legacyWins),
    });
    expect(await run(legacyWins, ["--scaffold"], ["claude"])).toMatchObject({ code: 0, stderr: "" });
    expect(existsSync(join(legacyWins.projectRoot, "legacy/spec/seeds/.gitkeep"))).toBe(true);
    expect(readFileSync(legacyWins.configPath, "utf8")).toBe(legacyBytes);

    const defaultWins = fixture();
    seedConfig(defaultWins, { agents: ["claude"], machineProfile: "home", ...registeredProject(defaultWins) });
    expect(await run(defaultWins, ["--scaffold"], ["claude"])).toMatchObject({ code: 0, stderr: "" });
    expect(existsSync(join(defaultWins.projectRoot, "spec/seeds/.gitkeep"))).toBe(true);

    const idempotentExplicit = fixture();
    seedConfig(idempotentExplicit, {
      agents: ["claude"],
      machineProfile: "home",
      projects: {
        project: {
          root: idempotentExplicit.projectRoot,
          origin: "git@example.test:project.git",
          plan: { targetDir: "v2/spec" },
        },
      },
    });
    const writes = { count: 0 };
    expect(await run(idempotentExplicit, ["--target-dir", "v2/spec"], ["claude"], writes)).toMatchObject({
      code: 0,
      stderr: "",
    });
    expect(writes.count).toBe(0);
  });

  test("scaffold containment rejects lexical and physical escapes", async () => {
    const lexical = fixture();
    seedConfig(lexical, { agents: ["claude"], machineProfile: "home", ...registeredProject(lexical) });
    for (const bad of ["../outside", "/abs/spec", "nested/../../escape"]) {
      const configBytes = readFileSync(lexical.configPath, "utf8");
      const result = await run(lexical, ["--target-dir", bad, "--scaffold"], ["claude"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("relative non-traversing path");
      expect(readFileSync(lexical.configPath, "utf8")).toBe(configBytes);
    }
    expect(listFiles(lexical.projectRoot)).toEqual([]);

    for (const badOwned of ["", ".", "../escape", "/abs/spec", "a/../../b"]) {
      const ownedMalformed = fixture();
      const ownedBytes = seedConfig(ownedMalformed, {
        agents: ["claude"],
        machineProfile: "home",
        projects: { project: { root: ownedMalformed.projectRoot, plan: { targetDir: badOwned } } },
      });
      const result = await run(ownedMalformed, ["--scaffold"], ["claude"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("relative non-traversing path");
      expect(readFileSync(ownedMalformed.configPath, "utf8")).toBe(ownedBytes);
    }

    const symlinkEscape = fixture();
    const outsideDir = join(symlinkEscape.root, "outside");
    mkdirSync(outsideDir);
    symlinkSync(outsideDir, join(symlinkEscape.projectRoot, "evil"));
    seedConfig(symlinkEscape, { agents: ["claude"], machineProfile: "home", ...registeredProject(symlinkEscape) });
    const symlinkBytes = readFileSync(symlinkEscape.configPath, "utf8");
    const symlinkResult = await run(symlinkEscape, ["--target-dir", "evil", "--scaffold"], ["claude"]);
    expect(symlinkResult.code).toBe(1);
    expect(symlinkResult.stderr).toContain("escapes project root");
    expect(readFileSync(symlinkEscape.configPath, "utf8")).toBe(symlinkBytes);
    expect(existsSync(join(outsideDir, "seeds"))).toBe(false);
  });

  test("scaffold preflight avoids partial owned state", async () => {
    const preserved = fixture();
    seedConfig(preserved, { agents: ["claude"], machineProfile: "home", ...registeredProject(preserved) });
    mkdirSync(join(preserved.projectRoot, "spec", "seeds"), { recursive: true });
    writeFileSync(join(preserved.projectRoot, "spec", "seeds", ".gitkeep"), "keep-me");
    expect(await run(preserved, ["--scaffold"], ["claude"])).toMatchObject({ code: 0, stderr: "" });
    expect(readFileSync(join(preserved.projectRoot, "spec", "seeds", ".gitkeep"), "utf8")).toBe("keep-me");
    expect(existsSync(join(preserved.projectRoot, "spec", "ready-intents", ".gitkeep"))).toBe(true);

    const blocked = fixture();
    seedConfig(blocked, { agents: ["claude"], machineProfile: "home", ...registeredProject(blocked) });
    mkdirSync(join(blocked.projectRoot, "spec"));
    writeFileSync(join(blocked.projectRoot, "spec", "seeds"), "not-a-directory");
    const blockedBytes = readFileSync(blocked.configPath, "utf8");
    const blockedResult = await run(blocked, ["--scaffold"], ["claude"]);
    expect(blockedResult.code).toBe(1);
    expect(readFileSync(blocked.configPath, "utf8")).toBe(blockedBytes);
    expect(readFileSync(join(blocked.projectRoot, "spec", "seeds"), "utf8")).toBe("not-a-directory");
    expect(existsSync(join(blocked.projectRoot, "spec", "ready-intents"))).toBe(false);

    const carriesForward = fixture();
    seedConfig(carriesForward, { agents: ["claude"], machineProfile: "home", ...registeredProject(carriesForward) });
    expect(await run(carriesForward, ["--scaffold"], ["claude"])).toMatchObject({ code: 0, stderr: "" });
    const afterFirstRun = readFileSync(carriesForward.configPath, "utf8");
    const failingSecondRun = await run(carriesForward, ["--profile", "work"], ["claude"]);
    expect(failingSecondRun.code).toBe(1);
    expect(failingSecondRun.stderr).toContain("conflicts with --profile");
    expect(readFileSync(carriesForward.configPath, "utf8")).toBe(afterFirstRun);
    expect(existsSync(join(carriesForward.projectRoot, "spec", "seeds", ".gitkeep"))).toBe(true);
    expect(existsSync(join(carriesForward.projectRoot, "spec", "ready-intents", ".gitkeep"))).toBe(true);
  });

  test("scaffold guard inversions expose escaping or partial writes", async () => {
    // @mutate v2/src/commands/init.ts "return requestedTargetDir ?? owned ?? legacyModePlanTargetDir(existing) ?? \"spec\";" -> "return \"spec\";"
    // @mutate v2/src/commands/init.ts "if (requestedTargetDir === undefined || requestedTargetDir === owned) return { targetDir };" -> "if (true) return { targetDir };"
    // @mutate v2/src/commands/init.ts "if (!inside(projectRootReal, real)) {" -> "if (false) {"
    // @mutate v2/src/commands/init.ts "if (exists) continue;" -> "if (false) continue;"
    // @mutate v2/src/commands/init.ts "if (options.scaffold === true) scaffoldQueueDirs(registration.projectRoot, targetDir, writeQueueSentinel);" -> "scaffoldQueueDirs(registration.projectRoot, targetDir, writeQueueSentinel);"
    // @mutate v2/src/commands/init.ts "if (options.scaffold === true) assertScaffoldable(registration.projectRoot, targetDir);" -> ""
    const precedence = fixture();
    seedConfig(precedence, {
      agents: ["claude"],
      machineProfile: "home",
      projects: {
        project: {
          root: precedence.projectRoot,
          origin: "git@example.test:project.git",
          plan: { targetDir: "owned/spec" },
        },
      },
    });
    expect((await run(precedence, ["--scaffold"], ["claude"])).code).toBe(0);
    expect(existsSync(join(precedence.projectRoot, "owned", "spec", "seeds", ".gitkeep"))).toBe(true);

    const replacement = fixture();
    seedConfig(replacement, {
      agents: ["claude"],
      machineProfile: "home",
      projects: {
        project: {
          root: replacement.projectRoot,
          origin: "git@example.test:project.git",
          plan: { targetDir: "owned/spec" },
        },
      },
    });
    expect((await run(replacement, ["--target-dir", "new/spec"], ["claude"])).code).toBe(0);
    expect(JSON.parse(readFileSync(replacement.configPath, "utf8")).projects.project.plan.targetDir).toBe("new/spec");

    const containment = fixture();
    const outside = join(containment.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(containment.projectRoot, "evil"));
    seedConfig(containment, { agents: ["claude"], machineProfile: "home", ...registeredProject(containment) });
    expect((await run(containment, ["--target-dir", "evil", "--scaffold"], ["claude"])).code).toBe(1);
    expect(existsSync(join(outside, "seeds"))).toBe(false);

    const overwrite = fixture();
    seedConfig(overwrite, { agents: ["claude"], machineProfile: "home", ...registeredProject(overwrite) });
    mkdirSync(join(overwrite.projectRoot, "spec", "seeds"), { recursive: true });
    writeFileSync(join(overwrite.projectRoot, "spec", "seeds", ".gitkeep"), "keep-me");
    const overwriteResult = await run(overwrite, ["--scaffold"], ["claude"]);
    expect(overwriteResult.code).toBe(0);
    expect(readFileSync(join(overwrite.projectRoot, "spec", "seeds", ".gitkeep"), "utf8")).toBe("keep-me");

    const noOrdinaryWrite = fixture();
    seedConfig(noOrdinaryWrite, { agents: ["claude"], machineProfile: "home", ...registeredProject(noOrdinaryWrite) });
    expect((await run(noOrdinaryWrite, [], ["claude"])).code).toBe(0);
    expect(existsSync(join(noOrdinaryWrite.projectRoot, "spec"))).toBe(false);

    const preflightAtomicity = fixture();
    seedConfig(preflightAtomicity, {
      agents: ["claude"],
      machineProfile: "home",
      ...registeredProject(preflightAtomicity),
    });
    mkdirSync(join(preflightAtomicity.projectRoot, "blocked"));
    writeFileSync(join(preflightAtomicity.projectRoot, "blocked", "seeds"), "not-a-directory");
    const preflightBytes = readFileSync(preflightAtomicity.configPath, "utf8");
    const preflightResult = await run(preflightAtomicity, ["--target-dir", "blocked", "--scaffold"], ["claude"]);
    expect(preflightResult.code).toBe(1);
    expect(readFileSync(preflightAtomicity.configPath, "utf8")).toBe(preflightBytes);
  });
});

describe("init readiness", () => {
  test("setup renders the complete stable readiness report", async () => {
    // @mutate v2/src/commands/init.ts "io.stdout(renderReadinessReport(readinessResults));" -> ""
    const fx = fixture();
    mkdirSync(join(fx.projectRoot, "spec"));
    const result = await run(fx, ["--profile", "home"], ["claude"], undefined, {
      checkDaemon: async () => ({ state: "running" }),
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "bun ok",
        "github-auth ok",
        "agents ok",
        "machine-profile ok",
        "project-registration ok",
        "origin ok",
        "spec-directory ok",
        "daemon ok",
        "",
      ].join("\n"),
    );
  });

  test("readiness distinguishes required checks from warnings", async () => {
    const bunMissing = fixture();
    expect(
      (
        await run(bunMissing, ["--profile", "home"], ["claude"], undefined, {
          checkBunRuntime: async () => ({ ok: false, detail: "bun probe timed out" }),
        })
      ).code,
    ).toBe(1);

    const authMissing = fixture();
    expect(
      (
        await run(authMissing, ["--profile", "home"], ["claude"], undefined, {
          checkGithubAuth: async () => ({ ok: false, detail: "not logged in" }),
        })
      ).code,
    ).toBe(1);

    const noOrigin = fixture();
    expect(
      (
        await run(noOrigin, ["--profile", "home"], ["claude"], undefined, {
          git: (_cwd, args) => (args[0] === "rev-parse" ? noOrigin.projectRoot : undefined),
        })
      ).code,
    ).toBe(1);

    const driftedOrigin = fixture();
    seedConfig(driftedOrigin, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { project: { root: driftedOrigin.projectRoot, origin: "git@example.test:project.git" } },
    });
    expect(
      (
        await run(driftedOrigin, [], ["claude"], undefined, {
          git: (_cwd, args) => (args[0] === "rev-parse" ? driftedOrigin.projectRoot : "git@example.test:changed.git"),
        })
      ).code,
    ).toBe(1);

    const fx = fixture();
    const baseContext: ReadinessContext = {
      machinesDir: fx.machinesDir,
      profile: "home",
      agents: ["claude"],
      isExecutable: () => true,
      projectRoot: fx.projectRoot,
      projectRegistered: true,
      storedOrigin: "origin",
      targetDir: "spec",
    };
    const okProbes: ReadinessProbes = {
      checkBunRuntime: async () => ({ ok: true }),
      checkGithubAuth: async () => ({ ok: true }),
      currentOrigin: async () => "origin",
      directoryExists: () => true,
      checkDaemon: async () => ({ state: "running" }),
    };
    expect(readinessExitCode(await evaluateReadiness({ ...baseContext, isExecutable: () => false }, okProbes))).toBe(1);
    expect(readinessExitCode(await evaluateReadiness({ ...baseContext, profile: "work" }, okProbes))).toBe(1);
    expect(readinessExitCode(await evaluateReadiness({ ...baseContext, projectRegistered: false }, okProbes))).toBe(1);

    const specDirMissingAlone = fixture();
    expect(
      (
        await run(specDirMissingAlone, ["--profile", "home"], ["claude"], undefined, {
          checkDaemon: async () => ({ state: "running" }),
        })
      ).code,
    ).toBe(0);

    const daemonStoppedAlone = fixture();
    mkdirSync(join(daemonStoppedAlone.projectRoot, "spec"));
    expect((await run(daemonStoppedAlone, ["--profile", "home"], ["claude"])).code).toBe(0);
  });

  test("readiness normalizes bounded probes and origin drift", async () => {
    const timeoutFx = fixture();
    const timeoutResult = await run(timeoutFx, ["--profile", "home"], ["claude"], undefined, {
      checkGithubAuth: async () => {
        throw new Error("gh auth status timed out\nwith extra diagnostic lines");
      },
    });
    expect(timeoutResult.code).toBe(1);
    expect(timeoutResult.stdout).toContain("github-auth missing: gh auth status timed out\n");
    expect(timeoutResult.stdout).not.toContain("with extra diagnostic lines");

    const exceptionFx = fixture();
    const exceptionResult = await run(exceptionFx, ["--profile", "home"], ["claude"], undefined, {
      checkBunRuntime: async () => {
        throw new Error("bun probe crashed");
      },
    });
    expect(exceptionResult.code).toBe(1);
    expect(exceptionResult.stdout).toContain("bun missing: bun probe crashed\n");

    const driftFx = fixture();
    const driftBytes = seedConfig(driftFx, {
      agents: ["claude"],
      machineProfile: "home",
      projects: { project: { root: driftFx.projectRoot, origin: "git@example.test:project.git" } },
    });
    const driftResult = await run(driftFx, [], ["claude"], undefined, {
      git: (_cwd, args) => (args[0] === "rev-parse" ? driftFx.projectRoot : "git@example.test:changed.git"),
    });
    expect(driftResult.code).toBe(1);
    expect(driftResult.stdout).toContain(
      "origin warn: stored origin 'git@example.test:project.git' does not match current 'git@example.test:changed.git'\n",
    );
    expect(readFileSync(driftFx.configPath, "utf8")).toBe(driftBytes);
  });

  test("setup retains state after readiness failure", async () => {
    const fx = fixture();
    const result = await run(fx, ["--profile", "home", "--scaffold"], ["claude"], undefined, {
      checkGithubAuth: async () => ({ ok: false, detail: "not logged in" }),
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(readFileSync(fx.configPath, "utf8"))).toMatchObject({
      machineProfile: "home",
      agents: ["claude"],
    });
    expect(existsSync(join(fx.projectRoot, "spec", "seeds", ".gitkeep"))).toBe(true);
    expect(existsSync(join(fx.projectRoot, "spec", "ready-intents", ".gitkeep"))).toBe(true);
  });

  test("readiness evaluator guard inversions expose false admission", async () => {
    // @mutate v2/src/commands/init-readiness.ts "const ordered = orderReadinessResults(results);" -> "const ordered = results;"
    // @mutate v2/src/commands/init-readiness.ts "return results.some((result) => isReadinessCheckRequired(result.id) && result.status !== \"ok\") ? 1 : 0;" -> "return 0;"
    // @mutate v2/src/commands/init-readiness.ts "const unrunnable = context.agents.filter((agent) => !context.isExecutable(agent));" -> "const unrunnable: string[] = [];"
    // @mutate v2/src/commands/init-readiness.ts "const originMatches = current === context.storedOrigin;" -> "const originMatches = true;"
    // @mutate v2/src/commands/init-readiness.ts "const line = value.split(/\\r?\\n/).find((part) => part.trim().length > 0) ?? \"\";" -> "const line = value;"
    // @mutate v2/src/commands/init-readiness.ts "return REQUIRED_READINESS_CHECKS.has(id);" -> "return true;"
    const fx = fixture();
    const baseContext: ReadinessContext = {
      machinesDir: fx.machinesDir,
      profile: "home",
      agents: ["claude"],
      isExecutable: () => true,
      projectRoot: fx.projectRoot,
      projectRegistered: true,
      storedOrigin: "origin",
      targetDir: "spec",
    };
    const okProbes: ReadinessProbes = {
      checkBunRuntime: async () => ({ ok: true }),
      checkGithubAuth: async () => ({ ok: true }),
      currentOrigin: async () => "origin",
      directoryExists: () => true,
      checkDaemon: async () => ({ state: "running" }),
    };

    // report order: the renderer must restore canonical order even from scrambled evaluation output.
    const scrambled = [
      { id: "daemon", status: "ok" },
      { id: "bun", status: "ok" },
      { id: "github-auth", status: "ok" },
      { id: "agents", status: "ok" },
      { id: "machine-profile", status: "ok" },
      { id: "project-registration", status: "ok" },
      { id: "origin", status: "ok" },
      { id: "spec-directory", status: "ok" },
    ] as const;
    expect(renderReadinessReport(scrambled)).toBe(`${READINESS_CHECK_ORDER.map((id) => `${id} ok`).join("\n")}\n`);

    // requiredness: a required failure must drive exit code 1.
    expect(readinessExitCode([{ id: "bun", status: "missing" }])).toBe(1);

    // configured-agent runnable binding: an unrunnable configured agent fails "agents".
    const unrunnable = await evaluateReadiness({ ...baseContext, isExecutable: () => false }, okProbes);
    expect(unrunnable.find((result) => result.id === "agents")?.status).toBe("missing");

    // origin consistency: a drifted stored origin must not read as ok.
    const drifted = await evaluateReadiness(baseContext, { ...okProbes, currentOrigin: async () => "different" });
    expect(drifted.find((result) => result.id === "origin")?.status).not.toBe("ok");

    // bounded-probe normalization: multiline probe detail collapses to its first line.
    const multiline = await evaluateReadiness(baseContext, {
      ...okProbes,
      checkBunRuntime: async () => ({ ok: false, detail: "line one\nline two" }),
    });
    expect(multiline.find((result) => result.id === "bun")?.detail).toBe("line one");

    // warning guard: spec-directory and daemon stay non-required.
    expect(isReadinessCheckRequired("spec-directory")).toBe(false);
    expect(isReadinessCheckRequired("daemon")).toBe(false);
  });
});

describe("init read-only check", () => {
  test("setup and check share the complete readiness report", async () => {
    // @mutate v2/src/commands/init.ts "io.stdout(renderReadinessReport(checkResults));" -> ""
    const fx = fixture();
    mkdirSync(join(fx.projectRoot, "spec"));
    seedConfig(fx, { agents: ["claude"], machineProfile: "home", ...registeredProject(fx) });
    const writes = { count: 0 };
    const result = await run(fx, ["--check"], ["claude"], writes, { checkDaemon: async () => ({ state: "running" }) });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "bun ok",
        "github-auth ok",
        "agents ok",
        "machine-profile ok",
        "project-registration ok",
        "origin ok",
        "spec-directory ok",
        "daemon ok",
        "",
      ].join("\n"),
    );
    expect(writes.count).toBe(0);
    expect(listFiles(fx.projectRoot)).toEqual([]);
  });

  test("check selectors do not establish setup state", async () => {
    const unregisteredName = fixture();
    seedConfig(unregisteredName, { agents: ["claude"], machineProfile: "home" });
    const writesA = { count: 0 };
    const resultA = await run(unregisteredName, ["--check", "--name", "demo"], ["claude"], writesA);
    expect(resultA.code).toBe(1);
    expect(resultA.stdout).toContain("project-registration missing");
    expect(writesA.count).toBe(0);

    const unconfiguredProfile = fixture();
    seedConfig(unconfiguredProfile, { agents: ["claude"], ...registeredProject(unconfiguredProfile) });
    const writesB = { count: 0 };
    const resultB = await run(unconfiguredProfile, ["--check", "--profile", "home"], ["claude"], writesB);
    expect(resultB.code).toBe(1);
    expect(resultB.stdout).toContain("machine-profile missing");
    expect(writesB.count).toBe(0);
    expect(JSON.parse(readFileSync(unconfiguredProfile.configPath, "utf8")).machineProfile).toBeUndefined();

    const explicitTargetDir = fixture();
    seedConfig(explicitTargetDir, {
      agents: ["claude"],
      machineProfile: "home",
      modes: { plan: { targetDir: "legacy/spec" } },
      projects: {
        project: {
          root: explicitTargetDir.projectRoot,
          origin: "git@example.test:project.git",
          plan: { targetDir: "owned/spec" },
        },
      },
    });
    mkdirSync(join(explicitTargetDir.projectRoot, "explicit", "spec"), { recursive: true });
    const writesC = { count: 0 };
    const resultC = await run(explicitTargetDir, ["--check", "--target-dir", "explicit/spec"], ["claude"], writesC, {
      checkDaemon: async () => ({ state: "running" }),
    });
    expect(resultC.code).toBe(0);
    expect(resultC.stdout).toContain("spec-directory ok");
    expect(writesC.count).toBe(0);
    expect(JSON.parse(readFileSync(explicitTargetDir.configPath, "utf8")).projects.project.plan.targetDir).toBe(
      "owned/spec",
    );

    const matchingSelectors = fixture();
    seedConfig(matchingSelectors, {
      agents: ["claude"],
      machineProfile: "home",
      ...registeredProject(matchingSelectors),
    });
    mkdirSync(join(matchingSelectors.projectRoot, "spec"));
    const writesD = { count: 0 };
    const resultD = await run(
      matchingSelectors,
      ["--check", "--profile", "home", "--name", "project"],
      ["claude"],
      writesD,
      { checkDaemon: async () => ({ state: "running" }) },
    );
    expect(resultD.code).toBe(0);
    expect(writesD.count).toBe(0);
  });

  test("check rejects unsafe or conflicting selectors", async () => {
    const conflict = fixture();
    const conflictBytes = seedConfig(conflict, {
      agents: ["claude"],
      machineProfile: "home",
      ...registeredProject(conflict),
    });
    const conflictResult = await run(conflict, ["--check", "--profile", "work"], ["claude"]);
    expect(conflictResult.code).toBe(1);
    expect(conflictResult.stderr).toContain("conflicts with --profile");
    expect(readFileSync(conflict.configPath, "utf8")).toBe(conflictBytes);

    const unsafeName = fixture();
    const unsafeBytes = seedConfig(unsafeName, { agents: ["claude"], machineProfile: "home" });
    const unsafeResult = await run(unsafeName, ["--check", "--name", "bad/name"], ["claude"]);
    expect(unsafeResult.code).toBe(1);
    expect(unsafeResult.stderr).toContain("must match");
    expect(readFileSync(unsafeName.configPath, "utf8")).toBe(unsafeBytes);

    const unknownProfile = fixture();
    const unknownBytes = seedConfig(unknownProfile, { agents: ["claude"], machineProfile: "home" });
    const unknownResult = await run(unknownProfile, ["--check", "--profile", "missing"], ["claude"]);
    expect(unknownResult.code).toBe(1);
    expect(unknownResult.stderr).toBe("init: unknown machine profile 'missing'; choose one of: home, work\n");
    expect(readFileSync(unknownProfile.configPath, "utf8")).toBe(unknownBytes);

    const malformedProfile = fixture();
    const malformedBytes = seedConfig(malformedProfile, { agents: ["claude"], machineProfile: 7 });
    const malformedResult = await run(malformedProfile, ["--check"], ["claude"]);
    expect(malformedResult.code).toBe(1);
    expect(malformedResult.stderr).toStartWith("init: Machine config");
    expect(readFileSync(malformedProfile.configPath, "utf8")).toBe(malformedBytes);

    const scaffoldRejected = fixture();
    const scaffoldBytes = seedConfig(scaffoldRejected, {
      agents: ["claude"],
      machineProfile: "home",
      ...registeredProject(scaffoldRejected),
    });
    const scaffoldResult = await run(scaffoldRejected, ["--check", "--scaffold"], ["claude"]);
    expect(scaffoldResult.code).toBe(1);
    expect(scaffoldResult.stderr).toContain("--scaffold");
    expect(readFileSync(scaffoldRejected.configPath, "utf8")).toBe(scaffoldBytes);
    expect(listFiles(scaffoldRejected.projectRoot)).toEqual([]);
  });

  test("check mode guard inversions expose implicit repair", async () => {
    // @mutate v2/src/commands/init.ts "if (options.check === true) {" -> "if (false) {"
    // read-only dispatch: --check must never fall through to setup's mutating path.
    const dispatch = fixture();
    const dispatchBytes = seedConfig(dispatch, { agents: ["claude"], machineProfile: "home" });
    const writesDispatch = { count: 0 };
    const dispatchResult = await run(dispatch, ["--check", "--name", "demo"], ["claude"], writesDispatch, {
      git: (_cwd, args) => (args[0] === "rev-parse" ? dispatch.projectRoot : "git@example.test:demo.git"),
    });
    expect(dispatchResult.code).toBe(1);
    expect(writesDispatch.count).toBe(0);
    expect(readFileSync(dispatch.configPath, "utf8")).toBe(dispatchBytes);

    // @mutate v2/src/commands/init.ts "return requestedTargetDir ?? owned ?? legacyModePlanTargetDir(existing) ?? \"spec\";" -> "return \"spec\";"
    // selector precedence: an explicit --target-dir must win over the stored owned target dir.
    const precedence = fixture();
    seedConfig(precedence, {
      agents: ["claude"],
      machineProfile: "home",
      projects: {
        project: {
          root: precedence.projectRoot,
          origin: "git@example.test:project.git",
          plan: { targetDir: "owned/spec" },
        },
      },
    });
    mkdirSync(join(precedence.projectRoot, "explicit", "spec"), { recursive: true });
    const precedenceResult = await run(
      precedence,
      ["--check", "--target-dir", "explicit/spec"],
      ["claude"],
      undefined,
      {
        checkDaemon: async () => ({ state: "running" }),
      },
    );
    expect(precedenceResult.stdout).toContain("spec-directory ok");

    // @mutate v2/src/commands/init-readiness.ts "if (context.profileConfigured === false) return missing(\"machine profile is not configured\");" -> ""
    // missing-configured-state: an unconfigured profile must not read as ok even when the roster binds.
    const unconfigured = fixture();
    seedConfig(unconfigured, { agents: ["claude"], ...registeredProject(unconfigured) });
    const unconfiguredResult = await run(unconfigured, ["--check", "--profile", "home"], ["claude"]);
    expect(unconfiguredResult.stdout).toContain("machine-profile missing");

    // @mutate v2/src/commands/init.ts "if (requestedProfile !== undefined && configuredProfile !== undefined && requestedProfile !== configuredProfile) {" -> "if (false) {"
    // profile conflict: a selector conflicting with the configured profile must reject, not silently pick one.
    const conflict = fixture();
    seedConfig(conflict, { agents: ["claude"], machineProfile: "home", ...registeredProject(conflict) });
    const conflictResult = await run(conflict, ["--check", "--profile", "work"], ["claude"]);
    expect(conflictResult.code).toBe(1);
    expect(conflictResult.stderr).toContain("conflicts with --profile");

    // @mutate v2/src/commands/init.ts "if (projectKey === undefined || !PROJECT_KEY_PATTERN.test(projectKey)) {" -> "if (false) {"
    // selector validation: an unsafe --name must reject before any probe runs.
    const unsafe = fixture();
    seedConfig(unsafe, { agents: ["claude"], machineProfile: "home" });
    const unsafeResult = await run(unsafe, ["--check", "--name", "bad/name"], ["claude"]);
    expect(unsafeResult.code).toBe(1);
    expect(unsafeResult.stderr).toContain("must match");

    // @mutate v2/src/commands/init.ts "if (options.scaffold === true) throw new Error(\"--check does not accept --scaffold\");" -> ""
    // scaffold-rejection: `--check --scaffold` must reject before any writes or probes.
    const scaffold = fixture();
    seedConfig(scaffold, { agents: ["claude"], machineProfile: "home", ...registeredProject(scaffold) });
    const scaffoldResult = await run(scaffold, ["--check", "--scaffold"], ["claude"]);
    expect(scaffoldResult.code).toBe(1);
    expect(listFiles(scaffold.projectRoot)).toEqual([]);
  });
});

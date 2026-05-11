import {
  cpSync,
  closeSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ClaudeAgent } from "../agents/claude.ts";
import { CodexAgent } from "../agents/codex.ts";
import { CursorAgent } from "../agents/cursor.ts";
import type { Agent } from "../agents/types.ts";
import { countUnchecked, getFirstUncheckedTask } from "../completion.ts";
import {
  type AgentName,
  type Config,
  type ConfigOptions,
  findProjectMatchForPath,
  loadConfig,
  openSessionLog,
  type ProjectMatch,
} from "../config.ts";
import { assertGhReady } from "../gh.ts";
import { createLogClient, type LogClient } from "../logging.ts";
import { buildPrompt } from "../prompt.ts";
import { ensureWorktree, createWorktreeSymlinks } from "../worktree.ts";

export type RunIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type ConfirmRun = (prompt: string) => string | Promise<string>;

export type Fanout = (
  tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
  text: string,
  stream: "stdout" | "stderr" | null,
  annotations?: Record<string, string | number | boolean | null>,
) => Promise<void>;

export type RunCommandOptions = {
  specPath: string;
  io: RunIo;
  config?: ConfigOptions;
  agents?: Partial<Record<AgentName, Agent>>;
  logClient?: LogClient;
  confirmRun?: ConfirmRun;
  handleSignals?: boolean;
  skipGhCheck?: boolean;
};

export async function runCommand(opts: RunCommandOptions): Promise<number> {
  let specPath = resolve(opts.specPath);
  if (!existsSync(specPath)) {
    opts.io.stderr(`spec path does not exist: ${specPath}\n`);
    return 1;
  }

  const cfg = loadConfig(opts.config);
  const project = findProjectMatchForPath(specPath, opts.config);
  if (project === undefined) {
    opts.io.stderr(
      "spec path is not inside any project registered with `jarvis init`.\n",
    );
    return 1;
  }

  if (!opts.skipGhCheck) {
    try {
      await assertGhReady();
    } catch (err) {
      opts.io.stderr(`${(err as Error).message}\n`);
      return 1;
    }
  }

  let agentWorkingDir = project.root;
  if (!opts.skipGhCheck) {
    try {
      agentWorkingDir = await ensureWorktree(project.root, specPath);
      createWorktreeSymlinks(
        project.root,
        agentWorkingDir,
        cfg.worktreeSymlinks,
      );
    } catch (err) {
      opts.io.stderr(
        `failed to create or resume worktree: ${(err as Error).message}\n`,
      );
      return 1;
    }
  }
  specPath = prepareAgentSpecPath({
    projectRoot: project.root,
    agentWorkingDir,
    specPath,
  });

  const isIndexSpec = basename(specPath) === "index.md";
  if (!isIndexSpec) {
    const specDir = dirname(specPath);
    const siblingIndex = resolve(specDir, "index.md");
    const hasSiblingIndex = existsSync(siblingIndex);

    const promptLines = [
      `${specPath} is not an index spec.`,
      ...(hasSiblingIndex ? ["  [s] switch to ./index.md and run normally"] : []),
      "  [m] migrate this spec to the index-routed shape",
      "  [e] exit",
      "Choice [e]: ",
    ];
    const promptText = promptLines.join("\n");
    opts.io.stdout(promptText);
    const answer = (await (opts.confirmRun ?? confirmFromStdin)(promptText))
      .trim()
      .toLowerCase();

    if (answer === "s" && hasSiblingIndex) {
      specPath = siblingIndex;
      // Fall through to continue with the normal index-spec path
    } else if (answer === "m") {
      // Set up everything needed for migration, then call runMigration
      const agentsByName = opts.agents ?? defaultAgents(cfg);
      const activeAgents = cfg.agentOrder
        .map((name) => agentsByName[name])
        .filter((agent): agent is Agent => agent !== undefined);
      const logServerUrl = cfg.logServerUrl ?? "http://127.0.0.1:4310/logs";
      const logClient = opts.logClient ?? createLogClient(logServerUrl);
      try {
        await logClient.assertReachable();
      } catch (err) {
        opts.io.stderr(
          `jarvis: log server unreachable at ${logServerUrl}. Start it with \`jarvis log-server\` or update config.\n`,
        );
        opts.io.stderr(`jarvis: ${(err as Error).message}\n`);
        return 1;
      }

      const sendLog = async (
        tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
        text: string,
        annotations?: Record<string, string | number | boolean | null>,
      ): Promise<void> => {
        try {
          const message = {
            namespace: project.key,
            text,
            tag,
            ...(annotations === undefined ? {} : { annotations }),
          };
          await logClient.send(message);
        } catch {
          // v1 best-effort after initial mandatory connectivity check
        }
      };
      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const sessionFd = openSessionLog(project.key, timestamp, opts.config);
      const writeSessionLine = (
        tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
        line: string,
      ): void => {
        const stamped = `${new Date().toISOString()} [${tag}] ${line}\n`;
        writeSync(sessionFd, stamped, undefined, "utf8");
      };
      const splitLines = (text: string): string[] => {
        const normalized = text.replace(/\r\n/g, "\n");
        const lines = normalized.split("\n");
        if (lines.at(-1) === "") {
          lines.pop();
        }
        return lines;
      };
      const writeLog = async (
        tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
        text: string,
        annotations?: Record<string, string | number | boolean | null>,
      ): Promise<void> => {
        for (const line of splitLines(text)) {
          writeSessionLine(tag, line);
          await sendLog(tag, line, annotations);
        }
      };
      const writeTerminal = (stream: "stdout" | "stderr", text: string): void => {
        if (stream === "stdout") {
          opts.io.stdout(text);
        } else if (stream === "stderr") {
          opts.io.stderr(text);
        }
      };
      const fanout: Fanout = async (
        tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
        text: string,
        stream: "stdout" | "stderr" | null,
        annotations?: Record<string, string | number | boolean | null>,
      ): Promise<void> => {
        if (stream !== null) {
          writeTerminal(stream, text);
        }
        await writeLog(tag, text, annotations);
      };

      const onSigint = () => {
        writeSessionLine("harness", "interrupted");
        opts.io.stderr("interrupted\n");
        process.exit(130);
      };
      if (opts.handleSignals !== false) {
        process.once("SIGINT", onSigint);
      }

      try {
        const result = await runMigration({
          specPath,
          project,
          cfg,
          agentWorkingDir,
          activeAgents,
          fanout,
          logServerUrl,
        });
        return result;
      } finally {
        closeSync(sessionFd);
        if (opts.handleSignals !== false) {
          process.removeListener("SIGINT", onSigint);
        }
      }
    } else {
      // e, empty input, or unrecognized
      return 0;
    }
  }

  const agentsByName = opts.agents ?? defaultAgents(cfg);
  const activeAgents = cfg.agentOrder
    .map((name) => agentsByName[name])
    .filter((agent): agent is Agent => agent !== undefined);
  const logServerUrl = cfg.logServerUrl ?? "http://127.0.0.1:4310/logs";
  const logClient = opts.logClient ?? createLogClient(logServerUrl);
  try {
    await logClient.assertReachable();
  } catch (err) {
    opts.io.stderr(
      `jarvis: log server unreachable at ${logServerUrl}. Start it with \`jarvis log-server\` or update config.\n`,
    );
    opts.io.stderr(`jarvis: ${(err as Error).message}\n`);
    return 1;
  }

  const sendLog = async (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    text: string,
    annotations?: Record<string, string | number | boolean | null>,
  ): Promise<void> => {
    try {
      const message = {
        namespace: project.key,
        text,
        tag,
        ...(annotations === undefined ? {} : { annotations }),
      };
      await logClient.send(message);
    } catch {
      // v1 best-effort after initial mandatory connectivity check
    }
  };
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const sessionFd = openSessionLog(project.key, timestamp, opts.config);
  const writeSessionLine = (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    line: string,
  ): void => {
    const stamped = `${new Date().toISOString()} [${tag}] ${line}\n`;
    writeSync(sessionFd, stamped, undefined, "utf8");
  };
  const splitLines = (text: string): string[] => {
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    return lines;
  };
  const writeLog = async (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    text: string,
    annotations?: Record<string, string | number | boolean | null>,
  ): Promise<void> => {
    for (const line of splitLines(text)) {
      writeSessionLine(tag, line);
      await sendLog(tag, line, annotations);
    }
  };
  const writeTerminal = (stream: "stdout" | "stderr", text: string): void => {
    if (stream === "stdout") {
      opts.io.stdout(text);
    } else if (stream === "stderr") {
      opts.io.stderr(text);
    }
  };
  const fanout = async (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    text: string,
    stream: "stdout" | "stderr" | null,
    annotations?: Record<string, string | number | boolean | null>,
  ): Promise<void> => {
    if (stream !== null) {
      writeTerminal(stream, text);
    }
    await writeLog(tag, text, annotations);
  };
  let iteration = 1;
  let latestIterationStdout: string[] = [];
  let latestIterationStderr: string[] = [];

  const printBoundedTail = (lines: string[]): void => {
    const tail = lines.slice(-40);
    for (const line of tail) {
      opts.io.stdout(`${line}\n`);
    }
  };

  const onSigint = () => {
    writeSessionLine("harness", "interrupted");
    opts.io.stderr("interrupted\n");
    process.exit(130);
  };
  if (opts.handleSignals !== false) {
    process.once("SIGINT", onSigint);
  }

  try {
    while (true) {
      if (isIndexSpec && iteration > cfg.maxIterations) {
        printBoundedTail([...latestIterationStdout, ...latestIterationStderr]);
        await fanout(
          "harness",
          `max iterations (${cfg.maxIterations}) reached; stopping\n`,
          "stderr",
        );
        return 5;
      }

      latestIterationStdout = [];
      latestIterationStderr = [];
      const before = countUnchecked(specPath);
      if (before === 0) {
        await fanout("harness", "spec complete\n", "stdout");
        return 0;
      }

      const agent = activeAgents[0];
      if (agent === undefined) {
        await fanout("harness", "all agents quota-exhausted\n", "stderr");
        return 2;
      }

      const task = getFirstUncheckedTask(specPath);
      const taskExcerpt = task.line.slice(0, 140);
      const banner = `project: ${project.key} | spec: ${basename(specPath)} | iteration: ${iteration} | current-task: ${task.ordinal}/${task.total} ${taskExcerpt} | agent: ${agent.name}\n`;
      await fanout("harness", banner, "stdout", {
        project: project.key,
        spec: basename(specPath),
        iteration,
        currentTask: taskExcerpt,
        currentTaskOrdinal: task.ordinal,
        currentTaskTotal: task.total,
        agent: agent.name,
      });
      const prompt = buildPrompt(specPath);
      await fanout("outbound", prompt, null, {
        iteration,
        agent: agent.name,
      });
      const result = await agent.run(prompt, {
        cwd: agentWorkingDir,
      });
      if (result.kind === "ok") {
        if (result.stdout.length > 0) {
          latestIterationStdout.push(...splitLines(result.stdout));
          await fanout("inbound_stdout", result.stdout, null, {
            iteration,
            agent: agent.name,
          });
        }
        if (result.stderr.length > 0) {
          latestIterationStderr.push(...splitLines(result.stderr));
          await fanout("inbound_stderr", result.stderr, null, {
            iteration,
            agent: agent.name,
          });
        }
        const after = countUnchecked(specPath);
        if (after === 0) {
          await fanout("harness", "spec complete\n", "stdout");
          return 0;
        }
        if (!isIndexSpec) {
          await fanout(
            "harness",
            "one-iteration run finished with unchecked tasks remaining\n",
            "stdout",
          );
          return 0;
        }
        if (after === before) {
          printBoundedTail([
            ...latestIterationStdout,
            ...latestIterationStderr,
          ]);
          await fanout(
            "harness",
            `iteration ${iteration} made no progress; stopping\n`,
            "stderr",
          );
          return 4;
        }
        iteration += 1;
        continue;
      }
      if (result.kind === "quota") {
        activeAgents.shift();
        await fanout(
          "harness",
          `${agent.name}: quota exhausted; falling back\n`,
          "stderr",
        );
        if (activeAgents.length === 0) {
          await fanout("harness", "all agents quota-exhausted\n", "stderr");
          return 2;
        }
        iteration += 1;
        continue;
      }
      if (result.kind === "model_config") {
        const configErr = `${agent.name}: configured patch model ${JSON.stringify(cfg.patchModels[agent.name])} is not supported by this CLI/account\n`;
        await fanout("harness", configErr, "stderr");
        if (result.stderr.length > 0) {
          const stderr = result.stderr.endsWith("\n")
            ? result.stderr
            : `${result.stderr}\n`;
          await fanout("harness", stderr, "stderr");
        }
        return 3;
      }

      if (result.stderr.length > 0) {
        const stderr = result.stderr.endsWith("\n")
          ? result.stderr
          : `${result.stderr}\n`;
        await fanout("harness", stderr, "stderr");
      }
      return 3;
    }
  } finally {
    closeSync(sessionFd);
    if (opts.handleSignals !== false) {
      process.removeListener("SIGINT", onSigint);
    }
  }
}

function buildMigrationPrompt(specPath: string): string {
  return [
    "You are migrating a non-compliant Jarvis spec to the index-routed shape.",
    "",
    "Read the target repo's spec guidance at docs/spec-guidance.md (or the equivalent in this repo's docs) and follow the \"Migrating Flat Specs\" procedure exactly.",
    "",
    `Spec to migrate: ${specPath}`,
    "",
    "Constraints:",
    "- Preserve the original spec's intent. Do not reword decisions, acceptance criteria, or task semantics.",
    "- Split the existing checklist into atomic, independently testable subspecs.",
    "- Create <dir>/index.md with a checklist linking to numbered subspec files.",
    "- Make the migration in place; do not leave the old flat spec behind unless the guidance says to.",
    "- Do not implement any of the subspecs. Only reshape the file(s).",
  ].join("\n");
}

async function runMigration(opts: {
  specPath: string;
  project: ProjectMatch;
  cfg: Config;
  agentWorkingDir: string;
  activeAgents: Agent[];
  fanout: Fanout;
  logServerUrl: string;
}): Promise<number> {
  const { specPath, project, cfg, agentWorkingDir, activeAgents, fanout } = opts;

  while (true) {
    const agent = activeAgents[0];
    if (agent === undefined) {
      await fanout("harness", "all agents quota-exhausted\n", "stderr");
      return 2;
    }

    const banner = `project: ${project.key} | spec: ${basename(specPath)} | mode: migrate | agent: ${agent.name}\n`;
    await fanout("harness", banner, "stdout", {
      project: project.key,
      spec: basename(specPath),
      mode: "migrate",
      agent: agent.name,
    });

    const prompt = buildMigrationPrompt(specPath);
    await fanout("outbound", prompt, null, {
      agent: agent.name,
    });

    const result = await agent.run(prompt, {
      cwd: agentWorkingDir,
    });

    if (result.kind === "ok") {
      if (result.stdout.length > 0) {
        await fanout("inbound_stdout", result.stdout, null, {
          agent: agent.name,
        });
      }
      if (result.stderr.length > 0) {
        await fanout("inbound_stderr", result.stderr, null, {
          agent: agent.name,
        });
      }
      await fanout("harness", "migration finished\n", "stdout");
      return 0;
    }

    if (result.kind === "quota") {
      activeAgents.shift();
      await fanout(
        "harness",
        `${agent.name}: quota exhausted; falling back\n`,
        "stderr",
      );
      if (activeAgents.length === 0) {
        await fanout("harness", "all agents quota-exhausted\n", "stderr");
        return 2;
      }
      continue;
    }

    if (result.kind === "model_config") {
      const configErr = `${agent.name}: configured patch model ${JSON.stringify(cfg.patchModels[agent.name])} is not supported by this CLI/account\n`;
      await fanout("harness", configErr, "stderr");
      if (result.stderr.length > 0) {
        const stderr = result.stderr.endsWith("\n")
          ? result.stderr
          : `${result.stderr}\n`;
        await fanout("harness", stderr, "stderr");
      }
      return 3;
    }

    if (result.stderr.length > 0) {
      const stderr = result.stderr.endsWith("\n")
        ? result.stderr
        : `${result.stderr}\n`;
      await fanout("harness", stderr, "stderr");
    }
    return 3;
  }
}

export function prepareAgentSpecPath(opts: {
  projectRoot: string;
  agentWorkingDir: string;
  specPath: string;
}): string {
  const projectRoot = resolve(opts.projectRoot);
  const agentWorkingDir = resolve(opts.agentWorkingDir);
  const specPath = resolve(opts.specPath);
  if (projectRoot === agentWorkingDir) {
    return specPath;
  }

  const relativeSpecPath = relative(projectRoot, specPath);
  if (relativeSpecPath.startsWith("..") || relativeSpecPath.startsWith("/")) {
    return specPath;
  }

  const agentSpecPath = resolve(agentWorkingDir, relativeSpecPath);
  if (!existsSync(agentSpecPath)) {
    copyMissingRecursive(dirname(specPath), dirname(agentSpecPath));
  }
  return agentSpecPath;
}

function copyMissingRecursive(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (existsSync(targetPath)) {
      if (entry.isDirectory()) {
        copyMissingRecursive(sourcePath, targetPath);
      }
      continue;
    }

    cpSync(sourcePath, targetPath, {
      recursive: entry.isDirectory(),
      force: false,
      errorOnExist: false,
    });
  }
}

async function confirmFromStdin(_prompt: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const newline = buffer.indexOf(10);
    if (newline !== -1) {
      chunks.push(buffer.subarray(0, newline));
      break;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function defaultAgents(cfg: Config): Record<AgentName, Agent> {
  return {
    claude: new ClaudeAgent({ model: cfg.patchModels.claude }),
    codex: new CodexAgent({ model: cfg.patchModels.codex }),
    cursor: new CursorAgent({ model: cfg.patchModels.cursor }),
  };
}

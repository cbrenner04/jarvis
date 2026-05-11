import { closeSync, existsSync, writeSync } from "node:fs";
import { basename, resolve } from "node:path";
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
} from "../config.ts";
import { createLogClient, type LogClient } from "../logging.ts";
import { buildPrompt } from "../prompt.ts";

export type RunIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type ConfirmRun = (prompt: string) => string | Promise<string>;

export type RunCommandOptions = {
  specPath: string;
  io: RunIo;
  config?: ConfigOptions;
  agents?: Partial<Record<AgentName, Agent>>;
  logClient?: LogClient;
  confirmRun?: ConfirmRun;
  handleSignals?: boolean;
};

export async function runCommand(opts: RunCommandOptions): Promise<number> {
  const specPath = resolve(opts.specPath);
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

  const isIndexSpec = basename(specPath) === "index.md";
  if (!isIndexSpec) {
    const prompt = `jarvis run expects an index spec.\nRun ${specPath} for one agent iteration anyway? [y/N] `;
    opts.io.stdout(prompt);
    const answer = (await (opts.confirmRun ?? confirmFromStdin)(prompt)).trim();
    if (!["y", "yes"].includes(answer.toLowerCase())) {
      return 1;
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
  const fanout = async (
    tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
    text: string,
    stream: "stdout" | "stderr" | null,
    annotations?: Record<string, string | number | boolean | null>,
  ): Promise<void> => {
    if (stream === "stdout") {
      opts.io.stdout(text);
    } else if (stream === "stderr") {
      opts.io.stderr(text);
    }
    for (const line of splitLines(text)) {
      writeSessionLine(tag, line);
      await sendLog(tag, line, annotations);
    }
  };
  let iteration = 1;

  const onSigint = () => {
    opts.io.stderr("interrupted\n");
    process.exit(130);
  };
  if (opts.handleSignals !== false) {
    process.once("SIGINT", onSigint);
  }

  try {
    while (true) {
      if (isIndexSpec && iteration > cfg.maxIterations) {
        opts.io.stderr(
          `max iterations (${cfg.maxIterations}) reached; stopping\n`,
        );
        return 5;
      }

      const before = countUnchecked(specPath);
      if (before === 0) {
        await fanout("harness", "spec complete\n", "stdout");
        return 0;
      }

      const agent = activeAgents[0];
      if (agent === undefined) {
        opts.io.stderr("all agents quota-exhausted\n");
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
        cwd: project.root,
      });
      if (result.kind === "ok") {
        if (result.stdout.length > 0) {
          await fanout("inbound_stdout", result.stdout, "stdout", {
            iteration,
            agent: agent.name,
          });
        }
        if (result.stderr.length > 0) {
          await fanout("inbound_stderr", result.stderr, "stderr", {
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
        opts.io.stderr(
          `${agent.name}: configured patch model ${JSON.stringify(cfg.patchModels[agent.name])} is not supported by this CLI/account\n`,
        );
        if (result.stderr.length > 0) {
          opts.io.stderr(
            result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`,
          );
        }
        return 3;
      }

      if (result.stderr.length > 0) {
        opts.io.stderr(
          result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`,
        );
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

// Permission posture: safe-edits (see spec/2026-05-11-permissions/00-default-posture.md).
// Sandbox flags: --sandbox workspace-write -c approval_policy="on-request"
// (see spec/2026-05-11-permissions/02-codex-flags.md).
// Invokes the `codex` CLI in non-interactive exec mode: `codex exec` with the
// prompt piped on stdin. Stdin is used (instead of an argv positional) so the
// prompt size is not bounded by the OS argv limit; `codex exec` reads the
// prompt from stdin when none is supplied positionally. Quota detection is
// handled after process exit.
//
// `--color never`: documented on `codex exec --help`; disables ANSI so session
// logs match Claude/Cursor-style plain text more closely.

import { computeCost } from "../prices/cost.ts";
import { loadPrices } from "../prices/load.ts";
import {
  findCodexSessionFile,
  findCodexSessionFilesSince,
  getCodexSessionsDir,
  latestCodexSessionMtime,
  parseCodexSessionUsage,
} from "./codex-session.ts";
import { runAgent } from "./spawn.ts";
import type { Agent, AgentResult, AgentRunOptions } from "./types.ts";

export type CodexAgentOptions = {
  binary?: string;
  model?: string;
};

const CODEX_MODEL_LABELS: Record<string, string> = {};

export class CodexAgent implements Agent {
  readonly name = "codex" as const;
  readonly #binary: string;
  readonly #model: string | undefined;

  constructor(opts: CodexAgentOptions = {}) {
    this.#binary = opts.binary ?? "codex";
    this.#model = opts.model;
  }

  async run(prompt: string, opts: AgentRunOptions): Promise<AgentResult> {
    const sessionsDir = getCodexSessionsDir();
    const snapshotMtime = latestCodexSessionMtime(sessionsDir);

    const result = await runAgent(
      {
        name: this.name,
        binary: this.#binary,
        cwd: opts.cwd,
        buildArgv: (_prompt, _opts) => {
          const argv = [
            "exec",
            "--color",
            "never",
            "--sandbox",
            "workspace-write",
            "-c",
            'approval_policy="on-request"',
          ];
          if (this.#model !== undefined) {
            argv.push("--model", this.#model);
          }
          return argv;
        },
        stdio: ["pipe", "pipe", "pipe"],
        writeStdin: (stdin, prompt) => {
          stdin.write(prompt);
          stdin.end();
        },
        streamErrorPrefix: "codex:",
      },
      prompt,
      opts,
    );

    if (result.kind !== "ok") {
      return result;
    }

    const warnings: string[] = [];
    let usage:
      | {
          input_tokens: number | null;
          output_tokens: number | null;
          cache_read_input_tokens: number | null;
          cache_creation_input_tokens: number | null;
        }
      | undefined;

    const newFiles = findCodexSessionFilesSince({ sessionsDir, snapshotMtime });
    if (newFiles.length === 0) {
      warnings.push("codex session file not found after invocation");
    } else if (newFiles.length > 1) {
      warnings.push(
        `multiple codex session files detected; using newest: ${newFiles[0]} (also saw ${newFiles[1]})`,
      );
    }

    const sessionFile = findCodexSessionFile({ sessionsDir, snapshotMtime });
    if (sessionFile !== null) {
      const parsed = parseCodexSessionUsage(sessionFile);
      warnings.push(...parsed.warnings);
      if (parsed.usage !== null) {
        usage = parsed.usage;
      }
    }

    const output: AgentResult = { ...result };
    const usageForTelemetry = usage ?? {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    };
    output.usage = usageForTelemetry;
    try {
      const prices = loadPrices();
      const computed = computeCost(
        usageForTelemetry,
        this.#model ?? "codex-default",
        prices,
      );
      output.cost_usd = computed.cost_usd;
      output.cost_source = computed.cost_source ?? "computed";
    } catch {
      // best-effort: telemetry still records usage without cost
    }
    if (warnings.length > 0) {
      output.warnings = warnings;
    }
    return output;
  }

  attributionLabel(): string {
    if (this.#model === undefined) {
      return "codex (default model)";
    }
    return CODEX_MODEL_LABELS[this.#model] ?? this.#model;
  }
}

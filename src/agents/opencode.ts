// Permission posture: safe-edits (see spec/permissions/00-default-posture.md).
// Permission handling: configured in ~/.config/opencode/opencode.json (see
// spec/opencode-as-agent/04-opencode-permission-stanza.md). Jarvis does not
// pass --dangerously-skip-permissions.
import { spawn } from "node:child_process";
import { isModelConfigurationSignal, isQuotaSignal } from "./quota.ts";
import type { Agent, AgentName, AgentResult } from "./types.ts";

export type OpencodeAgentOptions = {
  agentName?: AgentName;
  binary?: string;
  model: string;
};

export class OpencodeAgent implements Agent {
  readonly name: AgentName;
  readonly #binary: string;
  readonly #model: string;

  constructor(opts: OpencodeAgentOptions) {
    this.name = opts.agentName ?? "opencode";
    this.#binary = opts.binary ?? "opencode";
    this.#model = opts.model;
  }

  run(prompt: string, opts: { cwd: string }): Promise<AgentResult> {
    return new Promise((resolvePromise) => {
      const child = spawn(
        this.#binary,
        ["run", "--model", this.#model, "--format", "default", prompt],
        {
          cwd: opts.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stdout = child.stdout;
      const stderr = child.stderr;
      if (stdout === null || stderr === null) {
        resolvePromise({
          kind: "error",
          exitCode: -1,
          stderr: "opencode: failed to open child process streams",
        });
        return;
      }

      let outBuf = "";
      let errBuf = "";
      let settled = false;
      const settle = (r: AgentResult) => {
        if (settled) return;
        settled = true;
        resolvePromise(r);
      };

      stdout.on("data", (chunk: Buffer) => {
        outBuf += chunk.toString("utf8");
      });
      stderr.on("data", (chunk: Buffer) => {
        errBuf += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        settle({
          kind: "error",
          exitCode: -1,
          stderr: `${errBuf}${String(err)}`,
        });
      });
      child.on("close", (code) => {
        if (code === 0) {
          settle({ kind: "ok", stdout: outBuf, stderr: errBuf });
          return;
        }
        const exitCode = code ?? -1;
        const diagnostics = `${errBuf}${outBuf}`;
        if (isModelConfigurationSignal(this.name, diagnostics)) {
          settle({ kind: "model_config", stderr: diagnostics });
          return;
        }
        if (isQuotaSignal(this.name, exitCode, diagnostics)) {
          settle({ kind: "quota", stderr: diagnostics });
          return;
        }
        settle({ kind: "error", exitCode, stderr: diagnostics });
      });
    });
  }
}

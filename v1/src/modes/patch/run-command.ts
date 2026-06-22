import { execFileSync } from "node:child_process";

export type RunCommandFn = (command: string, args: string[], cwd: string) => void;

export function defaultRunCommand(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: "pipe",
  });
}

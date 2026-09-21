import { describe, expect, test } from "bun:test";
import { evaluateReadiness, type ReadinessContext, type ReadinessProbes } from "./init-readiness.ts";

const context: ReadinessContext = {
  machinesDir: "machines",
  profile: "home",
  agents: ["claude"],
  isExecutable: () => true,
  projectRoot: "project",
  projectRegistered: true,
  storedOrigin: "origin",
  targetDir: "spec",
};

const probes: ReadinessProbes = {
  checkBunRuntime: async () => ({ ok: true }),
  checkGithubAuth: async () => ({ ok: true }),
  currentOrigin: async () => "origin",
  directoryExists: () => true,
};

async function daemonResult(state: "running" | "stopped" | "inconclusive") {
  const results = await evaluateReadiness(context, { ...probes, checkDaemon: async () => ({ state }) });
  return results.find((result) => result.id === "daemon");
}

describe("daemon readiness check", () => {
  test("reports running, stopped, and inconclusive daemon states distinctly", async () => {
    expect(await daemonResult("running")).toEqual({ id: "daemon", status: "ok" });
    expect(await daemonResult("stopped")).toEqual({
      id: "daemon",
      status: "missing",
      detail: "daemon is not running",
    });
    expect(await daemonResult("inconclusive")).toEqual({
      id: "daemon",
      status: "missing",
      detail: "daemon is not responding",
    });
  });
});

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as sharedGit from "../shared/git.ts";
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

const probesWithoutCurrentOrigin: ReadinessProbes = {
  checkBunRuntime: async () => ({ ok: true }),
  checkGithubAuth: async () => ({ ok: true }),
  directoryExists: () => true,
  checkDaemon: async () => ({ state: "running" }),
};

let remoteUrlSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  remoteUrlSpy?.mockRestore();
  remoteUrlSpy = undefined;
});

async function daemonResult(state: "running" | "stopped" | "inconclusive") {
  const results = await evaluateReadiness(context, { ...probes, checkDaemon: async () => ({ state }) });
  return results.find((result) => result.id === "daemon");
}

describe("default currentOrigin probe", () => {
  test("uses resolved remoteUrl for the origin readiness check", async () => {
    const url = "git@example.test:repo.git";
    remoteUrlSpy = spyOn(sharedGit, "remoteUrl").mockResolvedValue({ status: "resolved", url });
    const results = await evaluateReadiness(
      { ...context, storedOrigin: url, projectRoot: "/fake/project" },
      probesWithoutCurrentOrigin,
    );
    expect(results.find((result) => result.id === "origin")).toEqual({ id: "origin", status: "ok" });
    expect(remoteUrlSpy).toHaveBeenCalledWith("/fake/project", "origin", expect.anything());
  });
});

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

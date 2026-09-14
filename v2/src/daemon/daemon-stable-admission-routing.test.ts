import { describe, expect, test } from "bun:test";
import type { RpcHandler } from "../ipc/server.ts";
import { createMinimalDispatchWriteStep } from "../testing/workflow-step-fixtures.ts";
import { createStableAdmissionHandlers } from "./daemon-run-lifecycle-handlers.ts";

type Reply = { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string };

function localHandlers(calls: string[]): { resume: RpcHandler; start: RpcHandler } {
  const local =
    (method: string): RpcHandler =>
    () => {
      calls.push(method);
      return { kind: "response", result: { local: true } };
    };
  return { resume: local("resume"), start: local("start") };
}

function frame(
  method: "resume" | "start",
  params: unknown,
): { kind: "request"; id: string; method: string; params: unknown } {
  return { kind: "request", id: `request-${method}`, method, params };
}

async function unreached(): Promise<never> {
  throw new Error("must not resolve ownership");
}

describe("stable admission conflict routing", () => {
  test("resume forwards to the local handler once ownership resolves unowned", async () => {
    const calls: string[] = [];
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: async () => false,
      resolveOwnerForKey: unreached,
    });

    const result = await handlers.resume(frame("resume", { runId: "run-1" }), new AbortController().signal);
    expect(result).toEqual({ kind: "response", result: { local: true } });
    expect(calls).toEqual(["resume"]);
  });

  test("resume refuses run_owner_conflict without calling the local handler when the predecessor owns the run", async () => {
    const calls: string[] = [];
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: async () => true,
      resolveOwnerForKey: unreached,
    });

    const result = (await handlers.resume(frame("resume", { runId: "run-1" }), new AbortController().signal)) as Reply;
    expect(result).toMatchObject({ kind: "error", code: "run_owner_conflict" });
    expect(calls).toEqual([]);
  });

  test("resume with no runId calls the local handler without consulting ownership", async () => {
    const calls: string[] = [];
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: unreached,
      resolveOwnerForKey: unreached,
    });

    const result = await handlers.resume(frame("resume", {}), new AbortController().signal);
    expect(result).toEqual({ kind: "response", result: { local: true } });
    expect(calls).toEqual(["resume"]);
  });

  test("start with a direct write input forwards to the local handler once ownership resolves unowned", async () => {
    const calls: string[] = [];
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: unreached,
      resolveOwnerForKey: async () => false,
    });
    const input = { worktree: { projectName: "demo", branchName: "feature" } };

    const result = await handlers.start(frame("start", { input }), new AbortController().signal);
    expect(result).toEqual({ kind: "response", result: { local: true } });
    expect(calls).toEqual(["start"]);
  });

  test("start with a direct write input refuses worktree_claimed without calling the local handler when the predecessor owns the key", async () => {
    const calls: string[] = [];
    let queriedKey: { project: string; branch: string } | undefined;
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: unreached,
      resolveOwnerForKey: async (key) => {
        queriedKey = key;
        return true;
      },
    });
    const input = { worktree: { projectName: "demo", branchName: "feature" } };

    const result = (await handlers.start(frame("start", { input }), new AbortController().signal)) as Reply;
    expect(result).toMatchObject({ kind: "error", code: "worktree_claimed" });
    expect(queriedKey).toEqual({ project: "demo", branch: "feature" });
    expect(calls).toEqual([]);
  });

  test("start with workflow steps derives the key from the first step and refuses when owned", async () => {
    const calls: string[] = [];
    let queriedKey: { project: string; branch: string } | undefined;
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: unreached,
      resolveOwnerForKey: async (key) => {
        queriedKey = key;
        return true;
      },
    });
    const steps = [
      createMinimalDispatchWriteStep({
        worktree: {
          projectRoot: "/fake",
          projectName: "wf-project",
          branchName: "wf-branch",
          baseRef: "HEAD",
          jarvisRoot: "/fake/.jarvis",
        },
      }),
    ];

    const result = (await handlers.start(frame("start", { steps }), new AbortController().signal)) as Reply;
    expect(result).toMatchObject({ kind: "error", code: "worktree_claimed" });
    expect(queriedKey).toEqual({ project: "wf-project", branch: "wf-branch" });
    expect(calls).toEqual([]);
  });

  test("start with an empty steps array falls through to the local handler without consulting ownership", async () => {
    const calls: string[] = [];
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: unreached,
      resolveOwnerForKey: unreached,
    });

    const result = await handlers.start(frame("start", { steps: [] }), new AbortController().signal);
    expect(result).toEqual({ kind: "response", result: { local: true } });
    expect(calls).toEqual(["start"]);
  });

  test("start with neither input nor steps falls through to the local handler without consulting ownership", async () => {
    const calls: string[] = [];
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: unreached,
      resolveOwnerForKey: unreached,
    });

    const result = await handlers.start(frame("start", {}), new AbortController().signal);
    expect(result).toEqual({ kind: "response", result: { local: true } });
    expect(calls).toEqual(["start"]);
  });

  test("start with a worktree missing projectName falls through to the local handler without consulting ownership", async () => {
    const calls: string[] = [];
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: unreached,
      resolveOwnerForKey: unreached,
    });
    const input = { worktree: { branchName: "feature" } };

    const result = await handlers.start(frame("start", { input }), new AbortController().signal);
    expect(result).toEqual({ kind: "response", result: { local: true } });
    expect(calls).toEqual(["start"]);
  });

  test("start with a worktree missing branchName falls through to the local handler without consulting ownership", async () => {
    const calls: string[] = [];
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: unreached,
      resolveOwnerForKey: unreached,
    });
    const input = { worktree: { projectName: "demo" } };

    const result = await handlers.start(frame("start", { input }), new AbortController().signal);
    expect(result).toEqual({ kind: "response", result: { local: true } });
    expect(calls).toEqual(["start"]);
  });
  test("an ownership lookup that cannot be established falls back to local resume and start admission", async () => {
    const calls: string[] = [];
    const failing = async (): Promise<never> => {
      throw new Error("ownership refresh failed");
    };
    const handlers = createStableAdmissionHandlers(localHandlers(calls), {
      resolveOwner: failing,
      resolveOwnerForKey: failing,
    });
    const input = { worktree: { projectName: "demo", branchName: "feature" } };

    expect(await handlers.resume(frame("resume", { runId: "run-1" }), new AbortController().signal)).toEqual({
      kind: "response",
      result: { local: true },
    });
    expect(await handlers.start(frame("start", { input }), new AbortController().signal)).toEqual({
      kind: "response",
      result: { local: true },
    });
    expect(calls).toEqual(["resume", "start"]);
  });
});

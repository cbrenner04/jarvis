import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHeldWorkflowBindings } from "./run-control.ts";

const workDirs: string[] = [];

afterEach(() => {
  while (workDirs.length > 0) {
    const dir = workDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function freshCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), `held-bindings-${process.pid}-`));
  workDirs.push(dir);
  return dir;
}

async function startHeldInvocation(
  held: ReturnType<typeof createHeldWorkflowBindings>,
  cwd: string,
  signal?: AbortSignal,
) {
  const binding = held.createBinding({ agentId: "claude", adapterModel: "M1", priceKey: "P1" });
  return binding.invoke({ prompt: "p", cwd, ...(signal !== undefined ? { signal } : {}) });
}

test("createHeldWorkflowBindings settleFirst writes proof.txt and resolves ok", async () => {
  const held = createHeldWorkflowBindings();
  const cwd = freshCwd();
  const pending = startHeldInvocation(held, cwd);
  expect(held.pendingCount()).toBe(1);
  held.settleFirst();
  const result = await pending;
  expect(result).toEqual({ kind: "ok", stdout: "done", stderr: "" });
  expect(readFileSync(join(cwd, "proof.txt"), "utf8")).toBe("done\n");
});

test("createHeldWorkflowBindings abortAll resolves error without writing proof.txt", async () => {
  const held = createHeldWorkflowBindings();
  const cwd = freshCwd();
  const pending = startHeldInvocation(held, cwd);
  held.abortAll();
  const result = await pending;
  expect(result).toEqual({ kind: "error", exitCode: 1, stderr: "aborted" });
  expect(existsSync(join(cwd, "proof.txt"))).toBe(false);
});

test("createHeldWorkflowBindings settleAll settles every pending invocation", async () => {
  const held = createHeldWorkflowBindings();
  const cwd1 = freshCwd();
  const cwd2 = freshCwd();
  const pending1 = startHeldInvocation(held, cwd1);
  const pending2 = startHeldInvocation(held, cwd2);
  expect(held.pendingCount()).toBe(2);
  held.settleAll();
  await expect(Promise.all([pending1, pending2])).resolves.toEqual([
    { kind: "ok", stdout: "done", stderr: "" },
    { kind: "ok", stdout: "done", stderr: "" },
  ]);
});

test("createHeldWorkflowBindings abort signal settles as error", async () => {
  const held = createHeldWorkflowBindings();
  const cwd = freshCwd();
  const controller = new AbortController();
  const pending = startHeldInvocation(held, cwd, controller.signal);
  controller.abort();
  const result = await pending;
  expect(result).toEqual({ kind: "error", exitCode: 1, stderr: "aborted" });
  expect(held.isAbortSignalTriggered()).toBe(true);
  expect(existsSync(join(cwd, "proof.txt"))).toBe(false);
});

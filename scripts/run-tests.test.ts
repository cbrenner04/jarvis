import { describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aggregateTestFiles, runAggregateTests } from "./run-tests.ts";

describe("runAggregateTests", () => {
  test("serial aggregate runs one file at a time", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    let inFlight = 0;
    let maxInFlight = 0;
    const spawn = async (cmd: string, args: string[]) => {
      expect(cmd).toBe("bun");
      expect(args[0]).toBe("test");
      expect(args.includes("--parallel")).toBe(false);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    await runAggregateTests(1, spawn);

    expect(maxInFlight).toBe(1);
  });

  test("serial aggregate covers the aggregate roster in agent-then-integration order", async () => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    spyOn(process.stderr, "write").mockImplementation(() => true);
    const { agent, integration } = aggregateTestFiles();
    const expected = [...agent, ...integration];
    const spawned: string[] = [];
    const spawn = async (_cmd: string, args: string[]) => {
      const file = args[1];
      if (file !== undefined) {
        spawned.push(file);
      }
      return { status: 0, signal: null, stdout: "", stderr: "", timedOut: false };
    };

    await runAggregateTests(1, spawn);

    expect(spawned).toEqual(expected);
    for (const file of spawned) {
      expect(file.startsWith("v1/")).toBe(false);
    }
  });
});

describe("test:confirm:live", () => {
  test("test:confirm:live runs the aggregate runner serially", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:confirm:live"]).toBe("bun run scripts/run-tests.ts --serial");
  });
});

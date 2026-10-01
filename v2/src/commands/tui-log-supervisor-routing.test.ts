import { afterAll, describe, expect, mock, test } from "bun:test";
import { captureIo } from "../testing/cli-test-helpers.ts";
import * as supervisorModule from "../tui/tui-supervisor.ts";

describe("tui log supervisor routing", () => {
  afterAll(() => {
    mock.restore();
  });

  test("runTuiCommand starts the supervisor with tui log run-id argv when not a worker", async () => {
    const seenArgv: (readonly string[])[] = [];
    mock.module("../tui/tui-supervisor.ts", () => ({
      ...supervisorModule,
      isTuiSupervisorWorker: () => false,
      runTuiSupervisor: async (params: { argv: readonly string[] }) => {
        seenArgv.push(params.argv);
        return 0;
      },
    }));

    const { runTuiCommand } = await import("./tui.ts");
    const originalArgv = process.argv;
    process.argv = ["/usr/bin/node", "/path/jarvis", "tui", "log", "run-direct"];
    try {
      const code = await runTuiCommand(["log", "run-direct"], captureIo().io, {
        socketPath: "/tmp/s.sock",
        runTuiLogFollow: async () => 0,
      } as unknown as import("../cli/deps.ts").CliDeps);
      expect(code).toBe(0);
      expect(seenArgv).toEqual([["/usr/bin/node", "/path/jarvis", "tui", "log", "run-direct"]]);
    } finally {
      process.argv = originalArgv;
    }
  });
});

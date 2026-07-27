import { describe, expect, test } from "bun:test";
import type { CliDeps } from "../cli/deps.ts";
import { makeIpcClient } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { connectCleanupDaemonClient, formatCleanupAbsentDaemonMessage } from "./cleanup-daemon-client.ts";

const LIST_REQUEST_ID = "00000000-0000-4000-8000-0000000000d1";

describe("connectCleanupDaemonClient", () => {
  test("formatCleanupAbsentDaemonMessage names recovery without a socket path", () => {
    const message = formatCleanupAbsentDaemonMessage();
    expect(message).toContain("No daemon is listening for this build");
    expect(message).toContain("jarvis daemon start");
    expect(message).not.toMatch(/daemon-[0-9a-f]+\.sock/);
  });

  test("merges live runs from discovered sockets when invoking socket is absent", async () => {
    const INVOKING_SOCKET = "/tmp/jarvis/daemon-invoking.sock";
    const OTHER_SOCKET = "/tmp/jarvis/daemon-older.sock";
    const deps = {
      socketPath: INVOKING_SOCKET,
      socketDiscovery: async () => [OTHER_SOCKET],
      connectIpcClient: async (socketPath: string) => {
        if (socketPath === INVOKING_SOCKET) throw new Error("connect ENOENT invoking");
        return makeIpcClient([
          {
            kind: "response",
            id: LIST_REQUEST_ID,
            result: {
              runs: [{ runId: "run-1", project: "demo", branch: "main", status: "running", isLive: true }],
            },
          },
        ]);
      },
    } as CliDeps;

    await withFixedUuid(LIST_REQUEST_ID, async () => {
      const { client, hadReachableDaemon } = await connectCleanupDaemonClient(deps);
      expect(hadReachableDaemon).toBe(true);
      const runs = await client("demo", "main");
      expect(runs.some((run) => run.isLive)).toBe(true);
    });
  });
});

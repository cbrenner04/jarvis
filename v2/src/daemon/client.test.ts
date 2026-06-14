import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callDaemon } from "./client.ts";
import { daemonSocketPath } from "./paths.ts";
import { createDaemonHost } from "./server.ts";

describe("daemon client", () => {
  const hosts: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    while (hosts.length > 0) {
      const host = hosts.pop();
      if (host) await host.stop();
    }
  });

  test("request IDs match responses", async () => {
    const root = mkdtempSync(join(tmpdir(), "jarvis-daemon-"));
    const socketPath = daemonSocketPath(root);
    const host = createDaemonHost({ socketPath, pid: 42 });
    await host.start();
    hosts.push(host);

    const response = await callDaemon({ id: "client-1", method: "status" }, { socketPath });
    expect(response.id).toBe("client-1");
    expect(response.ok).toBe(true);
  });
});

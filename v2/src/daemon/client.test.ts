import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { openLogRepository } from "../log-repository.ts";
import { mkdtempJarvisDaemon } from "../testing/jarvis-root.ts";
import { callDaemon } from "./client.ts";
import { createDaemonHost } from "./server.ts";

describe("daemon client", () => {
  const hosts: Array<{ stop: () => Promise<void>; logRepository: { close: () => void } }> = [];

  afterEach(async () => {
    while (hosts.length > 0) {
      const host = hosts.pop();
      if (host) {
        host.logRepository.close();
        await host.stop();
      }
    }
  });

  test("request IDs match responses", async () => {
    const { root, socketPath } = mkdtempJarvisDaemon();
    const host = createDaemonHost({
      socketPath,
      pid: 42,
      logRepository: openLogRepository(join(root, "state", "logs.sqlite")),
    });
    await host.start();
    hosts.push(host);

    const response = await callDaemon({ id: "client-1", method: "status" }, { socketPath });
    expect(response.id).toBe("client-1");
    expect(response.ok).toBe(true);
  });
});

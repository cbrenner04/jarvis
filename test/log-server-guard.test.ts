import { describe, expect, test } from "bun:test";
import { createLogClient } from "../v1/src/logging.ts";

describe("live log-server test guard", () => {
  test("preload intercepts fetch to the default log-server URL", async () => {
    const response = await fetch("http://127.0.0.1:4310/logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        namespace: "jarvis",
        text: "healthcheck",
        tag: "harness",
      }),
    });
    expect(response.status).toBe(202);
  });

  test("createLogClient against the default URL succeeds without the operator server", async () => {
    const client = createLogClient("http://127.0.0.1:4310/logs");
    await expect(client.assertReachable()).resolves.toBeUndefined();
    await expect(
      client.send({ namespace: "jarvis", text: "probe", tag: "harness" }),
    ).resolves.toBeUndefined();
  });
});

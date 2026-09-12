import { describe, expect, test } from "bun:test";
import { resolveHandoffOptions } from "./daemon-entrypoint";

describe("resolveHandoffOptions", () => {
  test("omits predecessorSocketPath when DAEMON_PREDECESSOR_SOCKET_PATH is unset", () => {
    expect(resolveHandoffOptions({})).not.toHaveProperty("predecessorSocketPath");
  });

  test("includes predecessorSocketPath when DAEMON_PREDECESSOR_SOCKET_PATH is set", () => {
    expect(resolveHandoffOptions({ DAEMON_PREDECESSOR_SOCKET_PATH: "predecessor.sock" })).toHaveProperty(
      "predecessorSocketPath",
      "predecessor.sock",
    );
  });

  test("omits privateSocketPath when DAEMON_PRIVATE_SOCKET_PATH is unset", () => {
    expect(resolveHandoffOptions({})).not.toHaveProperty("privateSocketPath");
  });

  test("includes privateSocketPath when DAEMON_PRIVATE_SOCKET_PATH is set", () => {
    expect(resolveHandoffOptions({ DAEMON_PRIVATE_SOCKET_PATH: "private.sock" })).toHaveProperty(
      "privateSocketPath",
      "private.sock",
    );
  });
});

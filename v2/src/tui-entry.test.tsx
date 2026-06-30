import { describe, expect, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import type { TuiDaemonClient } from "./tui-daemon-client.ts";
import { TuiDaemonConnectionError } from "./tui-daemon-client.ts";
import { runTuiEntry, TUI_DAEMON_SOCKET_DISPLAY, type TuiViewState } from "./tui-entry.tsx";

function recordingViewHost(): { host: { show: (state: TuiViewState) => void }; states: TuiViewState[] } {
  const states: TuiViewState[] = [];
  return {
    states,
    host: {
      show(state: TuiViewState): void {
        states.push(state);
      },
    },
  };
}

function fakeClient(methods: string[]): TuiDaemonClient {
  return {
    async health() {
      methods.push("health");
      return { ok: true };
    },
    async status() {
      methods.push("status");
      return { state: "running" };
    },
    close(): void {},
  };
}

describe("runTuiEntry", () => {
  test("connected path records health and status through injectable client and view host, exits 0", async () => {
    const { host, states } = recordingViewHost();
    const methods: string[] = [];
    let seenSocketPath: string | undefined;

    const code = await runTuiEntry({
      socketPath: "/tmp/tui.sock",
      viewHost: host,
      connectTuiDaemon: async (options) => {
        seenSocketPath = options?.socketPath;
        return fakeClient(methods);
      },
    });

    expect(code).toBe(0);
    expect(seenSocketPath).toBe("/tmp/tui.sock");
    expect(methods).toEqual(["health", "status"]);
    expect(states).toEqual([
      {
        kind: "connected",
        health: { ok: true },
        status: { state: "running" },
      },
    ]);
  });

  test("unavailable path records operator feedback naming the production socket and jarvis daemon start, exits 1", async () => {
    const { host, states } = recordingViewHost();
    const methods: string[] = [];

    const code = await runTuiEntry({
      socketPath: "/tmp/missing.sock",
      viewHost: host,
      connectTuiDaemon: async () => {
        throw new TuiDaemonConnectionError("cannot connect");
      },
    });

    expect(code).toBe(1);
    expect(methods).toEqual([]);
    expect(states).toEqual([{ kind: "unavailable" }]);
    expect(TUI_DAEMON_SOCKET_DISPLAY).toBe("~/.jarvis/daemon.sock");
  });

  test("invokes only health and status on the 00 client", async () => {
    const sent: string[] = [];
    const { host } = recordingViewHost();

    await runTuiEntry({
      viewHost: host,
      connectTuiDaemon: async () => fakeClient(sent),
    });

    expect(sent).toEqual(["health", "status"]);
  });

  test("production path renders through injectable ink, not the view host", async () => {
    let inkRendered = false;
    let renderedNode: ReactNode | undefined;
    const methods: string[] = [];

    const code = await runTuiEntry({
      connectTuiDaemon: async () => fakeClient(methods),
      inkRender: (node) => {
        inkRendered = true;
        renderedNode = node;
        return {
          rerender: () => {},
          unmount: () => {},
          waitUntilExit: async () => undefined,
          waitUntilRenderFlush: async () => {},
          cleanup: () => {},
          clear: () => {},
        };
      },
    });

    expect(code).toBe(0);
    expect(inkRendered).toBe(true);
    expect(methods).toEqual(["health", "status"]);
    expect((renderedNode as ReactElement | undefined)?.props).toMatchObject({ health: { ok: true }, status: { state: "running" } });
  });
});

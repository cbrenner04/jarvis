import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileTuiRevisionReexecChannel,
  createInMemoryTuiRevisionReexecChannel,
  TUI_REEXEC_CHANNEL_ENV,
  type TuiRevisionReexecChannelPayload,
  tuiRevisionReexecChannelFromEnv,
} from "./tui-reexec-channel.ts";

const samplePayload: TuiRevisionReexecChannelPayload = {
  daemonRevision: "rev-a",
  carriedState: { selectedNodeId: "run-1", expandedPipelineNodeIds: ["pipe-a"] },
  workerArgv: ["/bin/node", "cli.js", "tui"],
};

describe("createInMemoryTuiRevisionReexecChannel", () => {
  test("take returns undefined until publish, then consumes the payload once", () => {
    const channel = createInMemoryTuiRevisionReexecChannel();
    expect(channel.take()).toBeUndefined();
    channel.publish(samplePayload);
    expect(channel.take()).toEqual(samplePayload);
    expect(channel.take()).toBeUndefined();
  });
});

describe("createFileTuiRevisionReexecChannel", () => {
  test("round-trips publish and take, removing the file", () => {
    const filePath = join(tmpdir(), `jarvis-tui-reexec-channel-${process.pid}-${Date.now()}.json`);
    const channel = createFileTuiRevisionReexecChannel(filePath);
    channel.publish(samplePayload);
    expect(existsSync(filePath)).toBe(true);
    expect(channel.take()).toEqual(samplePayload);
    expect(existsSync(filePath)).toBe(false);
    expect(channel.take()).toBeUndefined();
  });

  test("take returns undefined when the channel file is absent", () => {
    const filePath = join(tmpdir(), `jarvis-tui-reexec-channel-missing-${process.pid}-${Date.now()}.json`);
    const channel = createFileTuiRevisionReexecChannel(filePath);
    // @mutate src/tui/tui-reexec-channel.ts "if (!existsSync(filePath)) return undefined;" -> "if (existsSync(filePath)) return undefined;"
    expect(channel.take()).toBeUndefined();
  });
});

describe("tuiRevisionReexecChannelFromEnv", () => {
  test("uses a noop channel when the env var is unset", () => {
    const channel = tuiRevisionReexecChannelFromEnv({});
    // @mutate src/tui/tui-reexec-channel.ts "if (filePath === undefined) {" -> "if (filePath !== undefined) {"
    expect(channel.take()).toBeUndefined();
    expect(() => channel.publish(samplePayload)).not.toThrow();
  });

  test("uses the file channel when the env var is set", () => {
    const filePath = join(tmpdir(), `jarvis-tui-reexec-channel-env-${process.pid}-${Date.now()}.json`);
    const channel = tuiRevisionReexecChannelFromEnv({ [TUI_REEXEC_CHANNEL_ENV]: filePath });
    channel.publish(samplePayload);
    expect(channel.take()).toEqual(samplePayload);
  });
});

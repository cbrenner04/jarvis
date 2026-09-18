import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { trackedMkdtempSync } from "../../shared/tracked-temp-dir.test-support.ts";
import { runEntrypoint } from "./cli.ts";
import { type IpcServer, startIpcServer } from "./ipc/server.ts";
import { canUseUnixSockets } from "./testing/unix-socket.ts";

const cliEntrypoint = join(import.meta.dir, "cli.ts");
const socketTest = test.skipIf(!canUseUnixSockets());
const MIB = 1024 * 1024;
const HANG_MS = 20_000;

const homes: string[] = [];
const servers: IpcServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function seededPipelines(count: number, nameBytes: number) {
  return Array.from({ length: count }, (_, index) => ({
    pipelineId: `pipe-${String(index).padStart(6, "0")}`,
    name: `p${index}-${"x".repeat(nameBytes)}`,
    state: "running",
    seedPath: "seeds/intent.md",
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 1_700_000_000_000 - index,
    finishedAtMs: null,
    dismissedAt: null,
    stages: [],
  }));
}

function freshHome(): string {
  const home = trackedMkdtempSync(join(tmpdir(), "jcf-"));
  homes.push(home);
  return home;
}

/** A stub daemon at the stable address of a fresh jarvis home, serving `pipelines` for `pipeline_list`. */
async function seededHome(pipelines: unknown[]): Promise<string> {
  const home = freshHome();
  servers.push(
    await startIpcServer(join(home, "daemon.sock"), {
      pipeline_list: () => ({ kind: "response", result: { pipelines } }),
    }),
  );
  return home;
}

function spawnCli(args: readonly string[], home: string) {
  return Bun.spawn([process.execPath, cliEntrypoint, ...args], {
    env: { ...process.env, JARVIS_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("cli entrypoint flushes piped output before exit", () => {
  socketTest(
    "delivers a stdout payload far above pipe capacity intact",
    async () => {
      const pipelines = seededPipelines(600, 2_000);
      const expected = `${JSON.stringify({ pipelines })}\n`;
      expect(Buffer.byteLength(expected)).toBeGreaterThanOrEqual(MIB);
      const home = await seededHome(pipelines);

      const proc = spawnCli(["pipeline", "list", "--all", "--json"], home);
      const [stdout, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited]);

      const text = new TextDecoder().decode(stdout);
      expect(code).toBe(0);
      expect(stdout.byteLength).toBe(Buffer.byteLength(expected));
      expect(JSON.parse(text)).toEqual(JSON.parse(expected));
    },
    HANG_MS,
  );

  test(
    "delivers a stderr payload above pipe capacity intact with exit 1",
    async () => {
      const name = "u".repeat(100_000);
      const proc = spawnCli([name], freshHome());
      const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

      expect(code).toBe(1);
      expect(stderr).toContain(`unknown command: ${name}\n`);
    },
    HANG_MS,
  );

  socketTest(
    "exits with main's code when the stdout reader closes early",
    async () => {
      const home = await seededHome(seededPipelines(600, 2_000));

      const proc = spawnCli(["pipeline", "list", "--all", "--json"], home);
      const reader = proc.stdout.getReader();
      await reader.read();
      await reader.cancel();

      const outcome = await Promise.race([proc.exited, Bun.sleep(HANG_MS - 5_000).then(() => "hang" as const)]);
      if (outcome === "hang") proc.kill();
      expect(outcome).toBe(0);
    },
    HANG_MS,
  );
});

describe("runEntrypoint", () => {
  function harness() {
    const capture = (stream: PassThrough) => {
      let text = "";
      stream.on("data", (chunk: Buffer) => {
        text += chunk.toString();
      });
      return () => text;
    };
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const exits: number[] = [];
    return {
      streams: { stdout, stderr, exit: (code: number) => void exits.push(code) },
      exits,
      stdoutText: capture(stdout),
      stderrText: capture(stderr),
    };
  }

  test("exits with the run's code when it resolves", async () => {
    const h = harness();

    await runEntrypoint(async () => 7, h.streams);

    expect(h.exits).toEqual([7]);
    expect(h.stderrText()).toBe("");
  });

  test("prints a thrown error to stderr and exits 1, keeping stdout already written", async () => {
    const h = harness();

    await runEntrypoint(async () => {
      h.streams.stdout.write("written before throw\n");
      throw new Error("boom");
    }, h.streams);

    expect(h.exits).toEqual([1]);
    expect(h.stdoutText()).toBe("written before throw\n");
    expect(h.stderrText()).toContain("Error: boom");
  });

  test("prints a non-Error rejection as text", async () => {
    const h = harness();

    await runEntrypoint(async () => {
      throw "plain failure";
    }, h.streams);

    expect(h.exits).toEqual([1]);
    expect(h.stderrText()).toBe("plain failure\n");
  });
});

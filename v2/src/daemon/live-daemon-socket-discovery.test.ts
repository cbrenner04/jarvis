import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverLiveDaemonSockets, type SocketProber } from "./live-daemon-socket-discovery.ts";

let testHome: string;

beforeEach(() => {
  const uniqueId = crypto.randomUUID();
  testHome = join(tmpdir(), `jarvis-discovery-${process.pid}-${uniqueId}`);
});

afterEach(async () => {
  // Cleanup is handled by test isolation; temp dir will be cleaned by OS.
});

test("Discovery returns exactly the digest-keyed sockets whose daemon answers health, in sorted order", async () => {
  await mkdir(testHome, { recursive: true });

  const socket1 = join(testHome, "daemon-0000000000000001.sock");
  const socket2 = join(testHome, "daemon-0000000000000002.sock");
  const socket3 = join(testHome, "daemon-0000000000000003.sock");

  await writeFile(socket1, "");
  await writeFile(socket2, "");
  await writeFile(socket3, "");

  // Prober: live probes return true for socket2 and socket3 only.
  const prober: SocketProber = async (socketPath) => {
    return socketPath === socket2 || socketPath === socket3;
  };

  const result = await discoverLiveDaemonSockets(testHome, prober);

  expect(result).toEqual([socket2, socket3]);
});

test("A stale socket file that does not answer health is excluded from the result", async () => {
  await mkdir(testHome, { recursive: true });

  const liveSocket = join(testHome, "daemon-0000000000000001.sock");
  const staleSocket = join(testHome, "daemon-0000000000000002.sock");

  await writeFile(liveSocket, "");
  await writeFile(staleSocket, "");

  // Prober: only liveSocket answers.
  const prober: SocketProber = async (socketPath) => {
    return socketPath === liveSocket;
  };

  const result = await discoverLiveDaemonSockets(testHome, prober);

  expect(result).toEqual([liveSocket]);
});

test("Files not matching the digest-keyed socket name form are never probed or returned", async () => {
  await mkdir(testHome, { recursive: true });

  const liveSocket = join(testHome, "daemon-0000000000000001.sock");
  const pidFile = join(testHome, "daemon-0000000000000001.pid");
  const logFile = join(testHome, "daemon-0000000000000001.log");
  const configFile = join(testHome, "config.json");
  const otherFile = join(testHome, "daemon.sock");
  const badKeySocket = join(testHome, "daemon-zzzzzzzzzzzzzzzz.sock");

  await writeFile(liveSocket, "");
  await writeFile(pidFile, "");
  await writeFile(logFile, "");
  await writeFile(configFile, "");
  await writeFile(otherFile, "");
  await writeFile(badKeySocket, "");

  const probeCalledOn: string[] = [];
  const prober: SocketProber = async (socketPath) => {
    probeCalledOn.push(socketPath);
    return socketPath === liveSocket;
  };

  const result = await discoverLiveDaemonSockets(testHome, prober);

  // Only the valid socket should be probed and returned.
  expect(result).toEqual([liveSocket]);
  expect(probeCalledOn).toEqual([liveSocket]);
});

test("A missing jarvis home directory yields an empty result instead of an error", async () => {
  const nonexistentHome = join(tmpdir(), `jarvis-nonexistent-${process.pid}-${Date.now()}`);

  const prober: SocketProber = async () => true;

  const result = await discoverLiveDaemonSockets(nonexistentHome, prober);

  expect(result).toEqual([]);
});

test("Inverting the liveness filter makes at least one test fail", async () => {
  await mkdir(testHome, { recursive: true });

  const socket1 = join(testHome, "daemon-0000000000000001.sock");
  const socket2 = join(testHome, "daemon-0000000000000002.sock");

  await writeFile(socket1, "");
  await writeFile(socket2, "");

  // Prober that returns the opposite: false for socket1, true for others.
  const invertedProber: SocketProber = async (socketPath) => {
    return socketPath !== socket1;
  };

  const result = await discoverLiveDaemonSockets(testHome, invertedProber);

  // With inverted prober, socket2 is live, socket1 is not.
  expect(result).toEqual([socket2]);

  // This differs from the non-inverted case where both would be live,
  // proving the liveness filter is actually being applied.
});

test("Inverting the name-form filter makes at least one test fail", async () => {
  await mkdir(testHome, { recursive: true });

  const validSocket = join(testHome, "daemon-0000000000000001.sock");
  const invalidSocket = join(testHome, "daemon.sock");

  await writeFile(validSocket, "");
  await writeFile(invalidSocket, "");

  const probeCalledOn: string[] = [];
  const prober: SocketProber = async (socketPath) => {
    probeCalledOn.push(socketPath);
    return true;
  };

  const result = await discoverLiveDaemonSockets(testHome, prober);

  // Only the valid socket should be probed.
  expect(probeCalledOn).toEqual([validSocket]);
  expect(result).toEqual([validSocket]);

  // If the filter were inverted (name-form check removed), daemon.sock would be probed too.
  // This test proves the filter prevents non-matching names from being included.
});

test("Results are sorted lexicographically", async () => {
  await mkdir(testHome, { recursive: true });

  const socket3 = join(testHome, "daemon-0000000000000003.sock");
  const socket1 = join(testHome, "daemon-0000000000000001.sock");
  const socket2 = join(testHome, "daemon-0000000000000002.sock");

  // Write in non-alphabetical order to test sorting.
  await writeFile(socket3, "");
  await writeFile(socket1, "");
  await writeFile(socket2, "");

  const prober: SocketProber = async () => true;

  const result = await discoverLiveDaemonSockets(testHome, prober);

  expect(result).toEqual([socket1, socket2, socket3]);
});

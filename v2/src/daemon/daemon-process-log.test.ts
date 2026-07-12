import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFileSync,
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { followDaemonProcessLog, readDaemonProcessLog } from "./daemon-process-log.ts";

const TEST_POLL_MS = 20;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jarvis-daemon-log-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function collectIo() {
  let out = "";
  let err = "";
  return {
    writeOut: (s: string) => {
      out += s;
    },
    writeErr: (s: string) => {
      err += s;
    },
    out: () => out,
    err: () => err,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("readDaemonProcessLog writes retained bytes and exits 0", () => {
  const path = join(dir, "daemon.log");
  writeFileSync(path, "line one\nline two\n");
  const io = collectIo();

  const code = readDaemonProcessLog(path, io);

  expect(code).toBe(0);
  expect(io.out()).toBe("line one\nline two\n");
  expect(io.err()).toBe("");
});

test("readDaemonProcessLog reports the missing configured path and exits nonzero", () => {
  const path = join(dir, "absent.log");
  const io = collectIo();

  const code = readDaemonProcessLog(path, io);

  expect(code).not.toBe(0);
  expect(io.err()).toContain(path);
});

test("followDaemonProcessLog replays retained content losslessly then follows appends", async () => {
  const path = join(dir, "daemon.log");
  writeFileSync(path, "before\n");
  const io = collectIo();
  const controller = new AbortController();

  // Appended immediately after the call, before any await runs in the
  // caller — the replay-to-follow handoff must not drop or duplicate it.
  const promise = followDaemonProcessLog(path, io, controller.signal, undefined, TEST_POLL_MS);
  appendFileSync(path, "during\n");
  setTimeout(() => appendFileSync(path, "after\n"), 40);
  setTimeout(() => controller.abort(), 200);

  const code = await promise;

  expect(code).toBe(130);
  expect(io.out()).toBe("before\nduring\nafter\n");
});

test("followDaemonProcessLog resumes from the current file after truncation", async () => {
  const path = join(dir, "daemon.log");
  writeFileSync(path, "retained\n");
  const io = collectIo();
  const controller = new AbortController();

  const promise = followDaemonProcessLog(path, io, controller.signal, undefined, TEST_POLL_MS);
  await sleep(40);
  truncateSync(path, 0);
  writeFileSync(path, "fresh\n");
  await sleep(120);
  controller.abort();

  const code = await promise;

  expect(code).toBe(130);
  expect(io.out()).toBe("retained\nfresh\n");
});

test("followDaemonProcessLog resumes from the current file after replacement", async () => {
  const path = join(dir, "daemon.log");
  writeFileSync(path, "old\n");
  const io = collectIo();
  const controller = new AbortController();

  const promise = followDaemonProcessLog(path, io, controller.signal, undefined, TEST_POLL_MS);
  await sleep(40);
  renameSync(path, join(dir, "old.log.1"));
  writeFileSync(path, "new\n");
  await sleep(120);
  controller.abort();

  const code = await promise;

  expect(code).toBe(130);
  expect(io.out()).toBe("old\nnew\n");
});

test("followDaemonProcessLog reports removal on stderr and exits nonzero", async () => {
  const path = join(dir, "daemon.log");
  writeFileSync(path, "content\n");
  const io = collectIo();
  const controller = new AbortController();

  const promise = followDaemonProcessLog(path, io, controller.signal, undefined, TEST_POLL_MS);
  await sleep(40);
  unlinkSync(path);

  const code = await promise;

  expect(code).not.toBe(130);
  expect(code).not.toBe(0);
  expect(io.err()).toContain(path);
});

test("followDaemonProcessLog reports the missing configured path before polling starts", async () => {
  const path = join(dir, "absent.log");
  const io = collectIo();
  const controller = new AbortController();

  const code = await followDaemonProcessLog(path, io, controller.signal, undefined, TEST_POLL_MS);

  expect(code).toBe(1);
  expect(io.err()).toContain(path);
});

test("followDaemonProcessLog exits 130 on SIGINT-driven abort with no other signal", async () => {
  const path = join(dir, "daemon.log");
  writeFileSync(path, "content\n");
  const io = collectIo();
  const controller = new AbortController();

  const promise = followDaemonProcessLog(path, io, controller.signal, undefined, TEST_POLL_MS);
  controller.abort();

  const code = await promise;

  expect(code).toBe(130);
});

test("followDaemonProcessLog reports an initial read failure on stderr and exits nonzero", async () => {
  const path = join(dir, "daemon.log");
  writeFileSync(path, "content\n");
  const io = collectIo();
  const controller = new AbortController();

  const failingFs = {
    existsSync: () => true,
    statSync: () => {
      throw new Error("boom");
    },
    openSync: () => {
      throw new Error("boom");
    },
    readSync: () => 0,
    closeSync: () => {},
  };

  const code = await followDaemonProcessLog(path, io, controller.signal, failingFs, TEST_POLL_MS);

  expect(code).not.toBe(0);
  expect(code).not.toBe(130);
  expect(io.err().length).toBeGreaterThan(0);
});

test("followDaemonProcessLog reports a mid-follow reopen failure on stderr and exits nonzero", async () => {
  const path = join(dir, "daemon.log");
  writeFileSync(path, "content\n");
  const io = collectIo();
  const controller = new AbortController();
  let statCalls = 0;

  const flakyFs = {
    existsSync: () => true,
    statSync: (p: string) => {
      statCalls += 1;
      if (statCalls > 1) throw new Error("reopen boom");
      return statSync(p);
    },
    openSync,
    readSync,
    closeSync,
  };

  const code = await followDaemonProcessLog(
    path,
    io,
    controller.signal,
    // @ts-expect-error partial fs seam for failure injection
    flakyFs,
    TEST_POLL_MS,
  );

  expect(code).not.toBe(0);
  expect(code).not.toBe(130);
  expect(io.err()).toContain("boom");
});

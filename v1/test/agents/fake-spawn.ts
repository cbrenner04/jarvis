import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";

export interface FakeSpawnRecord {
  binary: string;
  argv: readonly string[];
  opts: SpawnOptions;
}

export interface FakeSpawnRecorder {
  records: FakeSpawnRecord[];
  spawn: (binary: string, argv: readonly string[], opts: SpawnOptions) => ChildProcess;
}

class FakeChildProcess extends EventEmitter implements ChildProcess {
  readonly pid = 12345;
  readonly killed = false;
  readonly exitCode: number | null = null;
  readonly signalDescription: string | null = null;
  readonly spawnargs: string[] = [];
  readonly spawnfile = "";
  readonly connected = false;
  readonly signalCode: NodeJS.Signals | null = null;

  stdin: Writable | null = null;
  stdout: Readable | null = null;
  stderr: Readable | null = null;
  stdio: [Writable | null, Readable | null, Readable | null, Writable | Readable | null | undefined, Writable | Readable | null | undefined];

  constructor(stdout: string, stderr: string, exitCode: number = 0) {
    super();

    // Create stdin as a writable stream (tests might write to it)
    this.stdin = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });

    // Create readable streams for stdout/stderr from the provided strings
    this.stdout = Readable.from([stdout]);
    this.stderr = Readable.from([stderr]);

    this.stdio = [this.stdin, this.stdout, this.stderr, null, null];

    // Emit events on next tick so listeners can be registered first
    setImmediate(() => {
      this.emit("exit", exitCode);
      this.emit("close", exitCode);
    });
  }

  kill(_signal?: NodeJS.Signals | number): boolean {
    return true;
  }

  send(
    _message: any,
    _sendHandle?: any,
    _options?: any,
    _callback?: (error: Error | null) => void,
  ): boolean {
    return false;
  }

  disconnect(): void {}

  unref(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  [Symbol.dispose](): void {}
}

export function createFakeSpawnRecorder(): FakeSpawnRecorder {
  const records: FakeSpawnRecord[] = [];

  return {
    records,
    spawn: (binary: string, argv: readonly string[], opts: SpawnOptions): ChildProcess => {
      records.push({ binary, argv, opts });
      return new FakeChildProcess("", "");
    },
  };
}

export function createFakeSpawnWithOutput(
  outputMap: Record<string, { stdout: string; stderr: string; exit: number }>,
): FakeSpawnRecorder {
  const records: FakeSpawnRecord[] = [];

  return {
    records,
    spawn: (binary: string, argv: readonly string[], opts: SpawnOptions): ChildProcess => {
      records.push({ binary, argv, opts });

      const output = outputMap[binary] ?? { stdout: "", stderr: "", exit: 0 };
      return new FakeChildProcess(output.stdout, output.stderr, output.exit);
    },
  };
}

import type { IpcFrame } from "./types.ts";

const HEADER_BYTES = 4;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Encodes one length-prefixed UTF-8 JSON frame. */
export function encodeFrame(frame: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(frame), "utf8");
  if (body.length > MAX_FRAME_BYTES) {
    throw new RangeError(`frame body exceeds ${MAX_FRAME_BYTES} bytes`);
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Incremental decoder for length-prefixed frames on one byte stream. */
export class FrameDecoder {
  #buffer = Buffer.alloc(0);

  /** Appends bytes and returns every fully decoded frame. */
  push(chunk: Buffer): IpcFrame[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const frames: IpcFrame[] = [];

    while (true) {
      if (this.#buffer.length < HEADER_BYTES) {
        return frames;
      }

      const bodyLength = this.#buffer.readUInt32BE(0);
      if (bodyLength > MAX_FRAME_BYTES) {
        throw new Error("frame length exceeds maximum");
      }

      const frameBytes = HEADER_BYTES + bodyLength;
      if (this.#buffer.length < frameBytes) {
        return frames;
      }

      const body = this.#buffer.subarray(HEADER_BYTES, frameBytes);
      this.#buffer = this.#buffer.subarray(frameBytes);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        throw new Error("invalid JSON frame body");
      }

      frames.push(parsed as IpcFrame);
    }
  }

  /** True when a header or partial body is buffered. */
  hasPartialFrame(): boolean {
    return this.#buffer.length > 0;
  }
}

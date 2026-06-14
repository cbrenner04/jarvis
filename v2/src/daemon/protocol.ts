/** NDJSON request frame sent to the daemon. */
export type DaemonRequest = {
  id: string;
  method: string;
  params?: unknown;
};

/** Structured IPC error returned in a response frame. */
export type DaemonError = {
  code: string;
  message: string;
  data?: unknown;
};

/** NDJSON response frame from the daemon. */
export type DaemonResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: DaemonError;
};

/** Tagged stream frame multiplexed on the same socket (terminal response follows). */
export type DaemonStreamFrame = {
  kind: "stream";
  id: string;
  event: string;
  data?: unknown;
};

export type DaemonFrame = DaemonRequest | DaemonResponse | DaemonStreamFrame;

/** Serialize one NDJSON frame. */
export function encodeFrame(frame: DaemonFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Parse one NDJSON line into a request frame.
 * @throws When JSON is invalid or the frame shape is not a request.
 */
export function parseRequestLine(line: string): DaemonRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new ProtocolError("invalid_json", "request is not valid JSON");
  }

  if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.method !== "string") {
    throw new ProtocolError("invalid_request", "request must include string id and method");
  }

  const request: DaemonRequest = { id: parsed.id, method: parsed.method };
  if (parsed.params !== undefined) {
    request.params = parsed.params;
  }
  return request;
}

/**
 * Parse one NDJSON line into a response frame.
 * @throws When JSON is invalid or the frame shape is not a response.
 */
export function parseResponseLine(line: string): DaemonResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new ProtocolError("invalid_json", "response is not valid JSON");
  }

  if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.ok !== "boolean") {
    throw new ProtocolError("invalid_response", "response must include string id and boolean ok");
  }

  const response: DaemonResponse = { id: parsed.id, ok: parsed.ok };
  if (parsed.result !== undefined) {
    response.result = parsed.result;
  }
  if (parsed.error !== undefined) {
    if (!isRecord(parsed.error) || typeof parsed.error.code !== "string" || typeof parsed.error.message !== "string") {
      throw new ProtocolError("invalid_response", "error must include code and message");
    }
    const error: DaemonError = { code: parsed.error.code, message: parsed.error.message };
    if (parsed.error.data !== undefined) {
      error.data = parsed.error.data;
    }
    response.error = error;
  }
  return response;
}

/** Build a successful response for a request ID. */
export function okResponse(id: string, result: unknown): DaemonResponse {
  return { id, ok: true, result };
}

/** Build a failed response for a request ID. */
export function errorResponse(id: string, error: DaemonError): DaemonResponse {
  return { id, ok: false, error };
}

/**
 * Parse one NDJSON line into a stream frame.
 * @throws When JSON is invalid or the frame shape is not a stream frame.
 */
export function parseStreamLine(line: string): DaemonStreamFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new ProtocolError("invalid_json", "stream frame is not valid JSON");
  }

  if (
    !isRecord(parsed) ||
    parsed.kind !== "stream" ||
    typeof parsed.id !== "string" ||
    typeof parsed.event !== "string"
  ) {
    throw new ProtocolError("invalid_stream", "stream frame must include kind, id, and event");
  }

  const frame: DaemonStreamFrame = { kind: "stream", id: parsed.id, event: parsed.event };
  if (parsed.data !== undefined) {
    frame.data = parsed.data;
  }
  return frame;
}

/** Thrown when a frame cannot be parsed as the expected protocol shape. */
export class ProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

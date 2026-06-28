/** RPC request envelope correlated by `id`. */
export type RequestFrame = {
  kind: "request";
  id: string;
  method: string;
  params?: unknown;
};

/** RPC success envelope correlated to the request `id`. */
export type ResponseFrame = {
  kind: "response";
  id: string;
  result: unknown;
};

/** RPC failure envelope correlated to the request `id`. */
export type ErrorFrame = {
  kind: "error";
  id: string;
  code: string;
  message: string;
};

/** Opens a multiplexed stream slot on the connection. */
export type StreamOpenFrame = {
  kind: "stream-open";
  streamId: string;
  payload?: unknown;
};

/** Carries a base64-encoded byte chunk on an open stream. */
export type StreamDataFrame = {
  kind: "stream-data";
  streamId: string;
  payload?: string;
};

/** Closes a multiplexed stream slot. */
export type StreamEndFrame = {
  kind: "stream-end";
  streamId: string;
  payload?: unknown;
};

/** Discriminated wire envelope union keyed by `kind`. */
export type IpcFrame = RequestFrame | ResponseFrame | ErrorFrame | StreamOpenFrame | StreamDataFrame | StreamEndFrame;

/** Parsed `health` RPC result. */
export type HealthResult = {
  ok: true;
};

/** Parsed IPC `status` result — daemon-host liveness only. */
export type IpcStatusResult = {
  state: "running";
};

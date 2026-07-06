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
export type IpcFrame =
  | { kind: "request"; id: string; method: string; params?: unknown }
  | ResponseFrame
  | ErrorFrame
  | { kind: "stream-open"; streamId: string; payload?: unknown }
  | StreamDataFrame
  | StreamEndFrame;

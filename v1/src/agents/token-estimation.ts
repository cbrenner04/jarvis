import { getEncoding, type Tiktoken } from "js-tiktoken";

let encoder: Tiktoken | null = null;
let encoderInitFailed = false;

function getEncoder(loadEncoder: () => Tiktoken = () => getEncoding("cl100k_base")): Tiktoken | null {
  if (encoder !== null) return encoder;
  if (encoderInitFailed) return null;
  try {
    encoder = loadEncoder();
    return encoder;
  } catch {
    encoderInitFailed = true;
    return null;
  }
}

export type EstimatedTokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

/**
 * Best-effort usage estimator for agents that only control prompt + stdout.
 * Returns null when tokenizer init/encode fails so callers can mark usage as
 * unavailable instead of failing the run.
 */
export function estimateTokenUsage(args: {
  prompt: string;
  stdout: string;
  loadEncoder?: () => Tiktoken;
}): EstimatedTokenUsage | null {
  let enc: Tiktoken | null;
  if (args.loadEncoder !== undefined) {
    try {
      enc = args.loadEncoder();
    } catch {
      return null;
    }
  } else {
    enc = getEncoder();
  }
  if (enc === null) return null;
  try {
    return {
      input_tokens: enc.encode(args.prompt).length,
      output_tokens: enc.encode(args.stdout).length,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
  } catch {
    return null;
  }
}

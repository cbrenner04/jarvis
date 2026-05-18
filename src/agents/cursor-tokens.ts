import { getEncoding, type Tiktoken } from "js-tiktoken";

let encoder: Tiktoken | null = null;
let encoderInitFailed = false;

function getEncoder(): Tiktoken | null {
  if (encoder !== null) return encoder;
  if (encoderInitFailed) return null;
  try {
    encoder = getEncoding("cl100k_base");
    return encoder;
  } catch {
    encoderInitFailed = true;
    return null;
  }
}

export type EstimatedCursorUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

/**
 * Estimate cursor usage from what we control: the prompt we sent and the
 * stdout captured from the CLI. Cursor does not return usage; this is an
 * approximation labeled as "estimated" throughout the pipeline.
 *
 * Returns null on tokenizer failure; callers should fall back to
 * usage_source: "unavailable" in that case.
 */
export function estimateCursorUsage(args: {
  prompt: string;
  stdout: string;
}): EstimatedCursorUsage | null {
  const enc = getEncoder();
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

// Model ID mapping from jarvis model IDs (as used in data/prices.json and CLI)
// to models.dev provider-prefixed IDs.
//
// This mapping was established during the research phase (see
// spec/2026-05-16-token-and-cost-tracking/03-jarvis-prices-update.md#verified-upstream)
// and is hand-maintained. When a new model is added to prices.json, add an entry here
// to enable jarvis prices update to fetch its rates from models.dev.
export const MODELS_DEV_ID: Record<string, string> = {
  "claude-opus-4-7": "anthropic/claude-opus-4-7",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4-5",
  // cursor-default has no upstream entry; will be reported as not found
};

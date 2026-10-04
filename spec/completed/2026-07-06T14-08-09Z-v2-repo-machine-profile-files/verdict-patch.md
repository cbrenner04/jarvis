## Verdict: Required Refinements

**1. `v2/docs/daemon-host.md` must reflect the machine-profile migration.**
This doc still describes memory watermark config as sourced from `~/.jarvis/v2.json`'s `memory` key, and still shows `hasMemoryHeadroom` with an optional `configPath?` parameter and a `settleDelayMs` default attributed to that old config path. All three are now false: the sole source is the active machine profile file (`config/machines/<profile>.json`), `hasMemoryHeadroom` takes a required `profileName: string`, and the settle-delay default comes from `DEFAULT_SETTLE_DELAY_MS` in `machine-profile-loader.ts`. Update this doc to match current behavior. This is required by the repo rule that behavior changes update docs in the same subspec, and subspec 01's own checklist item to confirm the complete doc set — `daemon-host.md` documents this exact surface and was missed.

**2. The error surfaced when a profile's `models` key is absent must not claim the file is malformed.**
Today, a profile JSON missing the `models` key produces `"config file must be a JSON object"` via the reused `validateAgentModelConfig`, which is inaccurate in the profile-loader context (the file is valid JSON; only the `models` key is missing). Fix the message so it names the actual problem (missing `models` key) for callers going through the profile loader, without regressing the original file-based `loadAgentModelConfig` caller's behavior.

**3. `loadSettleDelayMs` needs direct test coverage.**
It's an exported function consumed by `daemon.ts`, but `memory-watermark.test.ts` only tests `hasMemoryHeadroom`. Add a direct test for `loadSettleDelayMs` (e.g., asserting it returns the profile's settle delay / the default when absent) so this wrapper isn't exercised only transitively through the well-tested `loadMachineProfileMemory`.

**Rationale:** #1 is a spec-compliance gap — stale documentation for changed operator-facing behavior, violating the doc-update requirement this spec's own checklist tried to guard against. #2 and #3 are small correctness/coverage fixes with no design tradeoff and should be resolved before this lands cleanly.
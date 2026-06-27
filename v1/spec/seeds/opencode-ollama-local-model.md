# opencode + ollama server as the local-model path

`opencode` talking to a local `ollama` server is not working right now. This is
the intended local-model fallback for v2 (qwen via opencode + ollama, replacing
the dropped aider path — see v2 docs). `opencode` is already a wired v1 adapter,
so the fix likely lives in how it's invoked/configured against an ollama server.

Desired: `opencode` can drive a model served by a local `ollama` server end to
end — a run using opencode→ollama completes a task instead of erroring. First
establish whether the failure is harness wiring (opencode adapter invocation,
model/endpoint config) or local environment/setup (ollama server not running,
model not pulled); fix the harness side, and if it's environment-only, say so and
do not change the harness.

This unblocks the v2 Phase 7 terminal local-model fallback (personal machine only).

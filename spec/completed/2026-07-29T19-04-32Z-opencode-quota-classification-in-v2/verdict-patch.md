Let me verify the key claims against the actual code before issuing a verdict.The key claims are verified. The implementation is faithful; the test uses a real 1s backoff, but `sleepMs` isn't plumbed through the binding path, so injecting a fake timer would require out-of-scope production changes. All acceptance criteria are satisfied and the ported patterns match v1.

No valid issues require actuator action. The one real observation (1s wall-clock backoff in the guarded-500 retry test) sits comfortably within the 30s test budget, and the clean remedy (threading `sleepMs` through `pickAgentRunOptions`) is outside this spec's scope and correctly deferred.

Empty verdict.
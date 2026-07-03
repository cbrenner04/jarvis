## Verdict

**Upheld:** The socket-unbind poll loop in `daemon.sandbox-unrunnable.test.ts` leaks a client connection on each iteration where `connectIpcClient` succeeds (i.e., while the socket is still bound, before `stopDaemon` completes). The opened client handle is never closed before the loop retries or exits.

**Required outcome:** Any successful `connectIpcClient` call inside the polling loop must have its resulting client closed before the loop proceeds to the next attempt or exits. This is test hygiene required to avoid leaking OS-level socket handles within the test's own lifetime, consistent with the spec's decision to keep exactly one tight, well-behaved real-process test in this file.

**Not upheld:** The claimed mismatch between `v2/docs/test-writing.md`'s description of the smoke test and the actual test file. On inspection, the file path, described sequence (start detached daemon → health request → status request → stopDaemon → poll for unbind), and the `daemon-registry.test.ts` reference all match the shipped code. No action required absent a concrete line-level discrepancy.

No other changes required — the spec's acceptance criteria (single test in the smoke file, status-RPC coverage restored, registry test moved to an agent-runnable file, DI coverage in `daemon-lifecycle.test.ts` confirmed to subsume removed assertions) are satisfied as implemented.
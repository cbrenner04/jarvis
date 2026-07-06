Verdict: refinement required.

## Upheld issue

The Decisions section states the "rebuild handlers directly instead of closing/reopening a socket server" rule using only two named tests as `e.g.` examples ("spawn boundary forwards original rejection", "terminal durable status is not overwritten"). The test file actually has five tests that reopen the server mid-test to swap `failureReporter`/`writeLoopExecutor`. Because the spec presents the rule via partial examples rather than as an exhaustive or general statement, a literal implementation could convert only the two named tests and leave the other three still calling `startIpcServer`/socket plumbing mid-test — which would violate this same subspec's own acceptance criterion that the file contain no references to `startIpcServer` (and related socket symbols).

## Required refinement

The Decisions section must state the mid-test rebuild rule so it unambiguously covers every test in the file that currently reopens the socket server to swap fixture state — either by:

- Stating the rule generally (e.g., "any test that closes/reopens the socket server mid-test to swap `failureReporter` or `writeLoopExecutor` instead reassigns `handlers` via a fresh `createRunControlHandlers(...)` call — this applies to every such test in the file, not just illustrative examples"), or
- Enumerating all affected tests exhaustively rather than using "e.g." with a partial list.

This must be resolved without expanding scope — it is a wording fix to an existing decision, not new work, and keeps the subspec's acceptance criteria (zero socket-symbol references, unchanged test count) actually achievable as written.
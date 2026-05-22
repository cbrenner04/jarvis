---
name: checks-before-pr-ready
---
we need to run checks before the pr ready step so when we get there we are actually ready for once

## Refine turn 1

### What the code already does

Both `maybeMarkReady` (patch mode, `src/modes/patch/pr.ts:117`) and `maybeMarkPlanPrReady` (plan mode, `src/modes/plan/pr.ts:255`) already run `bun run ready` — which expands to `bun install --frozen-lockfile && bun run typecheck && bun run test && bun run check` — before calling `gh pr ready <branch>`.

### The actual problem

Both functions run `execFileSync("bun", ["run", "ready"], { stdio: "pipe" })`. The `stdio: "pipe"` swallows all stdout and stderr from the check suite. When a check fails:

- **Patch mode**: the exception propagates to an outer try/catch in `src/modes/patch/run.ts:1185` which emits "failed to update PR for completed subspec `<path>`" — users see no output from the actual failed check (typecheck error, test failure, lint violation).
- **Plan mode**: `safeMarkPlanPrReady` (`src/commands/plan.ts:1870`) catches the exception and emits only "warning: could not mark PR ready for review: `<err.message>`" — again no check output. The PR stays as a draft silently.

In both modes the check output that would tell the user *why* the checks failed is lost.

### Scope

Change the `bun run ready` invocation in both `maybeMarkReady` and `maybeMarkPlanPrReady` so that when it fails, the captured stdout + stderr from the failed command is surfaced to the caller. The callers should then display that output so the user can see which check failed and why.

Concrete approach: use `spawnSync` (or `try/catch` on `execFileSync` with output capture) to capture the check output. On failure, construct an enriched error that includes the captured stdout/stderr so callers can emit it. The callers already have the right channels (`fanout` in patch mode, `io.stderr` in plan mode) to forward this output.

No change to when checks run or to the `bun run ready` command itself — only to how check failures are reported.

### Files in scope

- `src/modes/patch/pr.ts` — `maybeMarkReady` default `markReady` implementation
- `src/modes/plan/pr.ts` — `maybeMarkPlanPrReady` default `markReady` implementation
- `src/modes/patch/run.ts` — caller of `maybeMarkReady`; needs to emit enriched error output
- `src/commands/plan.ts` — `safeMarkPlanPrReady`; needs to emit enriched error output
- Tests: `test/modes/patch/pr.test.ts`, `test/modes/plan/pr.test.ts`

### Out of scope

- Changing *when* checks run (they already run at the right point).
- Changing the `bun run ready` command itself.
- Any CI/GitHub-side check integration.
- Fixing the type mismatch in `MaybeMarkReadyOpts.checkPrExists` (`boolean` vs `number | null`) — separate issue.

## Refine turn 2

### Error enrichment — implementation detail

When `execFileSync` fails with `stdio: "pipe"`, Node.js throws an `Error` that already carries `.stdout` and `.stderr` properties as `Buffer` objects. The default `markReady` implementation should catch that error and rethrow with a new `Error` whose message incorporates `stdout.toString()` and `stderr.toString()`. No `spawnSync` migration is needed; a `try/catch` around the existing `execFileSync` call is sufficient.

Preferred shape (apply identically to both `pr.ts` files):

```ts
try {
  execFileSync("bun", ["run", "ready"], { cwd, env: process.env, stdio: "pipe" });
} catch (err) {
  const out = (err as NodeJS.ErrnoException & { stdout?: Buffer; stderr?: Buffer });
  const captured = [out.stdout?.toString(), out.stderr?.toString()]
    .filter(Boolean)
    .join("\n")
    .trim();
  throw new Error(
    captured ? `bun run ready failed:\n${captured}` : `bun run ready failed`,
  );
}
```

The `gh pr ready` call that follows uses `stdio: "pipe"` too, but its errors already surface a useful message in `err.message`; leave it unchanged.

### Caller output format

**`run.ts` catch (line 1185):** Currently emits `failed to update PR for completed subspec <path>: <message>\n`. With multi-line check output now in `message`, this remains readable — no format change needed. The existing `\n` trailer is sufficient.

**`safeMarkPlanPrReady` (plan.ts line 1882):** Currently emits `warning: could not mark PR ready for review: <err.message>\n`. Same situation — multi-line messages will flow through correctly without a format change.

### Test strategy

Both functions expose a `markReady` test seam, so the default `execFileSync`-based implementation is not directly exercised by existing unit tests. For the enriched-error path, two test additions are appropriate:

1. **`pr.ts` unit tests (both files):** Add a test for the default `markReady` that calls `maybeMarkReady` / `maybeMarkPlanPrReady` without a `markReady` override, but with a `checkPrExists` that returns a valid PR, and where `bun run ready` is expected to fail. Since spawning a real process in tests is undesirable, the cleanest approach is to test the default implementation via a small helper that wraps the `execFileSync` catch logic directly — or accept that this path is covered only by the manual/integration path and skip a unit test for the Node.js error-property extraction itself.

2. **Caller tests (optional):** Test that `run.ts` and `safeMarkPlanPrReady` forward the full error message (including embedded check output) to their output channel. Use the `markReady` seam to throw an error whose message contains a fake multi-line check output, then assert `fanout` / `io.stderr` received the full string.

The spec should specify at minimum option 2 (caller forwarding tests) as they are straightforward. Option 1 (default impl extraction test) may be noted as out of scope for the unit test layer.

## Refine skip

All code locations, implementation details, and test strategy verified against the repo. The intent is complete and ready for drafting.

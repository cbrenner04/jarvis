# 00 — Capture and surface bun run ready output on failure

## Problem

Both `maybeMarkReady` (`src/modes/patch/pr.ts:117`) and `maybeMarkPlanPrReady`
(`src/modes/plan/pr.ts:255`) invoke `execFileSync("bun", ["run", "ready"], { stdio: "pipe" })`.
When `execFileSync` throws with `stdio: "pipe"`, Node.js attaches the captured stdout and stderr
as Buffer properties on the thrown error — but the current code lets the error propagate without
extracting them. When a typecheck error, test failure, or lint violation aborts the check suite,
users see only a generic wrapper message with no indication of which check failed or why.

## Decisions

- Use `try/catch` around the existing `execFileSync("bun", ["run", "ready"], ...)` call in
  both `pr.ts` files. No migration to `spawnSync` needed.
- On catch, extract `.stdout` and `.stderr` from the thrown `Error` (Node.js attaches these
  as `Buffer` properties when `stdio: "pipe"` is used) and rethrow a new `Error` whose message
  embeds the captured output.
- The `gh pr ready` call that follows uses `stdio: "pipe"` too, but its errors already surface a
  useful message in `err.message`; leave it unchanged.
- Callers (`run.ts` and `safeMarkPlanPrReady` in `plan.ts`) already forward `err.message` to
  their output channels; no caller format change is needed — multi-line messages flow through
  correctly.

## Tasks

- [ ] In `src/modes/patch/pr.ts`, wrap the `execFileSync("bun", ["run", "ready"], ...)` call
  in the default `markReady` implementation with a try/catch that extracts `.stdout` / `.stderr`
  from the error and rethrows an enriched `Error`:

  ```ts
  try {
    execFileSync("bun", ["run", "ready"], { cwd, env: process.env, stdio: "pipe" });
  } catch (err) {
    const out = err as NodeJS.ErrnoException & { stdout?: Buffer; stderr?: Buffer };
    const captured = [out.stdout?.toString(), out.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      captured ? `bun run ready failed:\n${captured}` : `bun run ready failed`,
    );
  }
  ```

- [ ] Apply the identical change to `src/modes/plan/pr.ts` in `maybeMarkPlanPrReady`'s default
  `markReady` implementation.

- [ ] Run `bun run typecheck` and `bun run test` to verify no regressions.

## Acceptance criteria

- [ ] When `bun run ready` exits non-zero in patch mode, the error message surfaced via `fanout`
  in `run.ts` includes the captured stdout/stderr from the failed command (e.g. TypeScript
  diagnostics, test failure output, lint violations).
- [ ] When `bun run ready` exits non-zero in plan mode, the warning emitted by
  `safeMarkPlanPrReady` via `io.stderr` includes the captured stdout/stderr from the failed
  command.
- [ ] When `bun run ready` succeeds, behaviour is unchanged in both modes.
- [ ] When `bun run ready` fails but produces no output (empty stdout and stderr), the error
  message is `bun run ready failed` with no trailing newline noise.
- [ ] `bun run typecheck` passes with no new errors.
- [ ] `bun run test` passes with no new failures.

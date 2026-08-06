# Documentation standard

Defines the operational meaning of "Documented in code".

## Inline standard

A doc-comment is not owed to every export — only to one whose contract isn't already evident from its name and type signature. Tier by how much the signature already tells you:

- **Evident from name + type**: no doc-comment. Adding one would only restate
  the type or narrate the body — comment why, not what; do not narrate
  obvious code.
- **One non-obvious fact** (what it's for, or when it applies, and that isn't
  evident from name + type): a one-liner stating that fact. Nothing more.
- **Genuinely non-obvious contract** (hidden preconditions, thrown errors,
  invariants the signature can't convey): a full contract block. Available
  tags are purpose, params, returns, thrown errors, invariants — include only
  the ones carrying non-obvious information, not every tag on every symbol.

In every tier, a comment must add information the code cannot: never restate a parameter/return type in prose, and never narrate what the body does line-by-line.

**Examples:**

```ts
// Evident — no comment needed.
function add(a: number, b: number): number {
  return a + b;
}

// One non-obvious fact — one-liner.
// Ports are tried in order; the first free one wins.
function pickPort(candidates: number[]): number { ... }

// Genuinely non-obvious contract — full block.
/**
 * Acquires the run-scoped lock file.
 * @param runId Must be a previously-registered run; unregistered ids throw.
 * @throws LockHeldError if another process holds the lock.
 * @invariant Caller must release() in a finally block or the lock leaks
 * until process exit.
 */
function acquireRunLock(runId: string): Lock { ... }
```

## Placement policy

Document each behavior in exactly one durable home. Cross-link; do not duplicate.

| Concern | Location |
| --- | --- |
| Single symbol contract (only when non-obvious; see Inline standard tiering) | Inline doc-comment |
| Non-obvious line/block rationale (why, tradeoff, invariant) | Inline comment near code |
| Cross-file architecture and boundaries | `v2/docs/` |
| Component/service contracts spanning files | `v2/docs/` |
| Operator/workflow behavior | `v2/docs/` |
| Design decisions and rationale | `v2/docs/` |
| Work intent and acceptance contract for a specific change | Spec (`v1/spec/` or `v2/spec/`) |

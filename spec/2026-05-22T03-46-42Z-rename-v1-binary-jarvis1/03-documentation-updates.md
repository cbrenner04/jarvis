# 03 — Documentation updates

Update all command-invocation examples in README.md, CLAUDE.md, and v1 docs from `jarvis` to `jarvis1`. Product-name prose ("Jarvis", "Name: `jarvis`"), data paths (`~/.jarvis/`), and repo identity are unchanged.

## Files in scope

- `README.md`
- `CLAUDE.md`
- `v1/docs/spec-guidance.md`
- `v1/docs/run-loop.md`
- `v1/docs/quota-signals.md`
- `v1/docs/agents.md`
- `v1/docs/plan-mode.md`
- `v1/docs/workflows.md`

## Changes per file

**`README.md`**
- Install symlink line: `ln -s ~/code/jarvis/bin/jarvis /usr/local/bin/jarvis` → `ln -s ~/code/jarvis/bin/jarvis1 /usr/local/bin/jarvis1`
- Shim description: "The root `bin/jarvis` shim dispatches to `v1/src/cli.ts`" → "The root `bin/jarvis1` shim dispatches to `v1/src/cli.ts`"
- All command-line examples: `jarvis help`, `jarvis init`, `jarvis plan`, `jarvis run`, `jarvis config`, `jarvis prices`, `jarvis log-server`, `jarvis cleanup`, `jarvis triage`, `jarvis review-feedback` → prefix each with `jarvis1`
- Add a note documenting the rename and rationale (v1 is now `jarvis1`; `jarvis` is reserved for v2)

**`CLAUDE.md`**
- Invocation-as-command references: `` run it through `jarvis` `` → `` run it through `jarvis1` ``; `` `jarvis config` ``, `` `jarvis run` ``, `` `jarvis plan` ``, `` `jarvis init` ``, `` `jarvis triage` ``, `` `jarvis cleanup` `` → `jarvis1` equivalents
- Product-name prose ("Jarvis is a minimal coding-agent harness", "Name: `jarvis`", "jarvis" as the project/product title) stays unchanged
- `~/.jarvis/` paths stay unchanged

**`v1/docs/spec-guidance.md`**
- All `jarvis run`, `jarvis plan`, `jarvis init`, `jarvis config` invocation examples → `jarvis1` equivalents
- `~/.jarvis/` path references stay unchanged

**`v1/docs/run-loop.md`, `v1/docs/quota-signals.md`, `v1/docs/agents.md`, `v1/docs/plan-mode.md`, `v1/docs/workflows.md`**
- Command invocation examples → `jarvis1` equivalents
- Product-name prose stays unchanged
- `~/.jarvis/` path references stay unchanged

## Do NOT change

- Product-name prose: "Jarvis", "Name: `jarvis`" in CLAUDE.md Core decisions
- `~/.jarvis/` data paths anywhere
- Git trailer names, PR narrative markers, internal protocol strings in docs
- CI workflow files (already confirmed no binary-name references)

## Task checklist

- [ ] Update `README.md` (install line, shim description, all command examples, add rename rationale note)
- [ ] Update `CLAUDE.md` (command invocation references only)
- [ ] Update `v1/docs/spec-guidance.md`
- [ ] Update `v1/docs/run-loop.md`
- [ ] Update `v1/docs/quota-signals.md`
- [ ] Update `v1/docs/agents.md`
- [ ] Update `v1/docs/plan-mode.md`
- [ ] Update `v1/docs/workflows.md`

## Acceptance criteria

- [ ] No `bin/jarvis` (as a path/command reference, not product name) remains in README.md, CLAUDE.md, or any `v1/docs/*.md` file
- [ ] No `` `jarvis `` command-invocation reference (backtick-prefixed, followed by a space and a subcommand) remains in the files listed above — product-name prose ("Jarvis", "Name: `jarvis`") is excluded from this check
- [ ] `bun run check` passes

## Documentation updates

This subspec is the documentation update.

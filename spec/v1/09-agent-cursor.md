# 09 — `cursor` adapter

Implement the `cursor` adapter against the interface from spec 07.

## Invocation

`cursor agent -p --workspace <cwd> "<prompt>"`

- `-p` / `--print` puts cursor in non-interactive headless mode (full tool access, including write and shell).
- `--workspace <cwd>` sets the working directory.
- The prompt is passed as the trailing positional argument.
- Consider `--output-format json` if structured parsing turns out to be needed; default `text` is fine for v1.

## Tasks

- [ ] `src/agents/cursor.ts` invokes the command above.
- [ ] Honors `cwd` via `--workspace`.
- [ ] Quota detection stubbed (real detection lands in spec 10).
- [ ] Tests mirror spec 07's shape.

## Acceptance criteria

- Adapter conforms to the `Agent` interface.
- Tests pass.

## Documentation updates

- Add `cursor` to the "Agents" section in `README.md` with the invocation noted.

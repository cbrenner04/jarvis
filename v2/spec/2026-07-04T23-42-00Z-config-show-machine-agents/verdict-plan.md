- Specify the operator-visible outcome for invalid `~/.jarvis/v2.json`. The spec currently distinguishes present vs absent override, but not malformed config. It must state whether `jarvis config show` surfaces a config error, treats it as no override, or does something else. This is load-bearing because all are plausible, observable CLI behaviors.

- Pin the read-only command output contract. The spec must say what `jarvis config show` emits for a configured override and for no override, and whether `jarvis config path` prints the literal `~/.jarvis/v2.json` token or an expanded absolute path. “Reports” / “prints” is too loose for a durable operator-facing command in `v2/docs/agent-model-config.md`.

- Cover the case where `~/.jarvis/v2.json` exists but has no `agents` override. The spec currently only names file-present and file-absent outcomes. It must state whether a file without `agents` is treated the same as no override or differently. That distinction is observable and materially affects the inspection command’s meaning.

- Add the required v1-behavior baseline doc update. Because this introduces new operator-visible `jarvis config` behavior rather than a purely internal change, the subspec’s documentation updates must include `v2/docs/v1-behaviors.md` per the spec guidance for behavior changes.

- Reconcile the architecture doc with the new command surface. The spec must state the intended outcome for the existing broader `jarvis config <project> <workflow>` language in `v2/docs/v2-architecture.md`: either narrow it to the focused show/edit surface, or explicitly defer broader config workflow detail elsewhere. A mere “cross-link” is not enough if the docs would still conflict.

- Bound this subspec to the new subcommands’ success-path semantics and inherited generic CLI errors, or explicitly specify more. Without that scope line, implementers may invent unknown-subcommand / usage behavior that belongs to the broader `config` surface rather than this change.

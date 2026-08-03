- Split the oversized draft into two serial, independently testable subspecs: monitor-state/control semantics first, then injected-input routing, hints, and documentation. Preserve every original task and acceptance outcome exactly once across the replacements, link every replacement from `index.md`, and declare the routing dependency.

- Clarify the staged submission boundary: this spec provides an inert handoff only. Production submission has no operator-visible dispatch effect until the follow-up command-dispatch work lands; parsing, RPC, feedback, and command execution remain out of scope.

- Define submission lifecycle completely. Focused Enter, including with an empty buffer, invokes submission exactly once with the current buffer and leaves focus, buffer, and cursor unchanged. Unfocused Enter does not submit.

- Define input precedence for combined Ink signals. Special keys and global Ctrl-C take precedence over insertion; Ctrl-C quits without inserting text. Other Ctrl/Meta-modified input neither edits nor triggers tree actions. Multi-grapheme paste inserts atomically and advances the cursor by its grapheme count.

- Resolve all multiline behavior. Specify Shift+Enter and pasted CR/LF handling consistently with multiline editing being out of scope, and remove any dock hint that advertises newline insertion.

- Require tree-focused negative coverage: printable input, Left/Right, Backspace, and Delete must leave command focus, buffer, and cursor unchanged.

- Strengthen grapheme behavior coverage with multi-code-point clusters for cursor movement, Backspace, and Delete, plus multi-grapheme insertion and cursor advancement. This is necessary to verify the declared grapheme-index contract rather than only ASCII behavior.

- Make refresh retention explicit: focus, buffer, and cursor must all survive refresh from a focused, nonempty, mid-buffer state, with the dock projection remaining accurate.

- Require mutation checkpoints for every added or modified executable guard, including focus routing, key classification/insertion precedence, Ctrl-C and Enter handling, edit suppression, and modified conditional hints. Negative-effect guards must be pinned by tests proving the suppressed effect remains absent; type-only changes need no mutation.

- Make mutation linkage unambiguous by naming the exact pinning test containing each `// @mutate` directive and ensuring each directive uniquely targets real production logic with no inversion hook. This is required for reliable harness verification.

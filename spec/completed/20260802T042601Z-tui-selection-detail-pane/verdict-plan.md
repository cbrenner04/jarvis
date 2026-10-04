- Split the oversized subspec into independently testable pipeline/stage projection, selected-run projection, and lossless-wrapping slices. Preserve every original task and acceptance outcome exactly once, link every replacement from `index.md`, and keep dependent slices sequential. Each runtime slice needs its own baseline-failing regression and guard-mutation coverage.

- Define an effective positive render width for side-by-side, stacked, and extremely narrow layouts. Width must mean terminal display columns, not JavaScript string length. Lossless wrapping must preserve content order and segment styling/tone.

- Clarify that “complete detail” means the pure renderer returns the complete ordered row sequence. Do not imply all rows are visible within a height-clipped pane because scrolling remains out of scope.

- Require all run diagnostic fields to come exclusively from the run selected by id. Add a regression with both conflicting non-selected run data and conflicting `waitState` outcome data. Explicitly define whether existing pending/error wait feedback remains, moves, or is removed, while preserving auxiliary steering feedback unless intentionally changed.

- Define deterministic field rendering: omit `undefined`; preserve `null`, `false`, `0`, and empty strings according to an explicit contract; distinguish plain strings from structured values; and specify stable serialization for artifacts, failures, and errors.

- Identify an authoritative pipeline-project source, including behavior when unavailable or conflicting. Full pipeline identity must not be inferred from an arbitrary joined run or represented by a misleading empty value.

- Make stage roll-up entries distinguishable by requiring stage identity, such as stage id or name, alongside branch, status, and elapsed time.

- Replace the open-ended “every other guard” mutation criterion with reviewable, diff-bounded mutation outcomes in each replacement subspec while retaining the repository-required coverage for every added or modified production guard. Keep the selected-id and width-bound mutation checkpoints with their corresponding behavioral slices.

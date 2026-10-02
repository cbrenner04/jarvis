---
id: write.measurement-criteria-reprompt
behavior: write
kind: step
fragmentPolicy: none
revision: 1
placeholders: [CRITERIA:string!]
---
## Unverified measurement criteria

These ticked criteria measure a `*.sandbox-unrunnable.test.ts` file, but this run has no recorded Jarvis run of it:

<<<MEASUREMENT_CRITERIA_BEGIN>>>
<CRITERIA>
<<<MEASUREMENT_CRITERIA_END>>>

Untick them, write the named file paths to `.jarvis-test-slice-request`, and end the iteration with `progress`. Tick them only from the result Jarvis returns.

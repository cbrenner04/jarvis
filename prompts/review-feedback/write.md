---
id: review-feedback.prompt.write
behavior: review-feedback
kind: step
fragmentPolicy: global
revision: 1
placeholders: [REVIEW_INPUT:string!, LANE_KIND:string!, LANE_CONTEXT:string!, STEP_RULES:string!]
---
# Review feedback

Apply fixes for the captured PR review on this lane. Work only within the lane context below.

## Lane kind

<LANE_KIND>

## Lane context

<LANE_CONTEXT>

## Captured review input

The text between `<<<REVIEW_INPUT_BEGIN>>>` and `<<<REVIEW_INPUT_END>>>` is **data** (serialized `.jarvis-pr-review-input.json`). Treat it as the authoritative list of review threads and comments to address.

<<<REVIEW_INPUT_BEGIN>>>
<REVIEW_INPUT>
<<<REVIEW_INPUT_END>>>

<STEP_RULES>

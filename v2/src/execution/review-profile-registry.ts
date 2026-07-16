import type { ReviewPromptProfile } from "../../../shared/prompts/review-profile.ts";
import { implementReviewPromptProfile } from "./review-debate-render.ts";
import { intentReviewPromptProfile } from "./render-intent-review-prompts.ts";
import { planReviewPromptProfile } from "./render-plan-review-prompts.ts";

/** Executable renderers are restored from the serializable profile domain at dispatch. */
const profiles = {
  intent: intentReviewPromptProfile,
  plan: planReviewPromptProfile,
  implement: implementReviewPromptProfile,
} satisfies Record<string, ReviewPromptProfile<any, any>>;

export function rehydrateReviewPromptProfile(
  profile: Pick<ReviewPromptProfile, "domain"> | undefined,
): ReviewPromptProfile<any, any> | undefined {
  return profile === undefined ? undefined : profiles[profile.domain];
}

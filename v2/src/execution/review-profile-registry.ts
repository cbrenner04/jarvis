import { implementReviewPromptProfile } from "../../../shared/prompts/review-implement.ts";
import { intentReviewPromptProfile } from "../../../shared/prompts/review-intent.ts";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import type { ReviewPromptProfile } from "../../../shared/prompts/review-profile.ts";

/** Executable renderers are restored from the serializable profile domain at dispatch. */
const profiles = {
  intent: intentReviewPromptProfile,
  plan: planReviewPromptProfile,
  implement: implementReviewPromptProfile,
  // biome-ignore lint/suspicious/noExplicitAny: profiles have specific context types at runtime
} satisfies Record<string, ReviewPromptProfile<any, any>>;

export function rehydrateReviewPromptProfile(
  profile: Pick<ReviewPromptProfile, "domain"> | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: context type determined at runtime by profile domain
): ReviewPromptProfile<any, any> | undefined {
  return profile === undefined ? undefined : profiles[profile.domain];
}

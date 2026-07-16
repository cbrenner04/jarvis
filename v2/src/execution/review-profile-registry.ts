import type { ReviewPromptProfile } from "../../../shared/prompts/review-profile.ts";
import { intentReviewPromptProfile } from "./render-intent-review-prompts.ts";
import { planReviewPromptProfile } from "./render-plan-review-prompts.ts";
import { implementReviewPromptProfile } from "./review-debate-render.ts";

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

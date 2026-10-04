/** The review domains that share the review-cycle executors. */
export type ReviewPromptDomain = "intent" | "plan" | "implement";

export type ReviewPromptProfile<Context = unknown, Role extends string = string> = {
  domain: ReviewPromptDomain;
  render: {
    critic: (context: Context) => string | Promise<string>;
    actuator: (context: Context, verdict: string) => string | Promise<string>;
    debateRole?: (role: Role, context: Context, priorOutput?: string) => string | Promise<string>;
  };
  verdict: {
    source: "critic" | "adjudicator";
    empty: "stop";
    persist: "stdout";
  };
  boundaries: {
    light: { critic: "read-only"; actuator: "write" };
    debate: { critic: "read-only"; actuator: "write" };
  };
};

type ProfileSpec = Omit<ReviewPromptProfile, "render">;

function profile(spec: ProfileSpec): ProfileSpec {
  return spec;
}

/** Domain policy is shared; render callbacks are bound by each prompt assembler. */
export const intentReviewProfile = profile({
  domain: "intent",
  verdict: { source: "critic", empty: "stop", persist: "stdout" },
  boundaries: {
    light: { critic: "read-only", actuator: "write" },
    debate: { critic: "read-only", actuator: "write" },
  },
});

export const planReviewProfile = profile({
  domain: "plan",
  verdict: { source: "critic", empty: "stop", persist: "stdout" },
  boundaries: {
    light: { critic: "read-only", actuator: "write" },
    debate: { critic: "read-only", actuator: "write" },
  },
});

export const implementReviewProfile = profile({
  domain: "implement",
  verdict: { source: "adjudicator", empty: "stop", persist: "stdout" },
  boundaries: {
    light: { critic: "read-only", actuator: "write" },
    debate: { critic: "read-only", actuator: "write" },
  },
});

export type ReviewProfileSpec = ProfileSpec;

export function bindReviewPromptProfile<Context, Role extends string>(
  spec: ProfileSpec,
  render: ReviewPromptProfile<Context, Role>["render"],
): ReviewPromptProfile<Context, Role> {
  return { ...spec, render } as ReviewPromptProfile<Context, Role>;
}

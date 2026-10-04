/**
 * Seed frontmatter metadata: the `name:` slug plus optional `risk:` / `effort:` ratings drawn from one
 * closed vocabulary. Pipeline selection (project minimums, CLI flags) shares `RATING_LEVELS`; this module
 * only validates what a seed supplies — a missing rating is admission's concern, not a parse error.
 */

/** Closed rating scale, ordered weakest to strongest. Definitions: `v2/docs/spec-guidance.md` § Seed ratings. */
export const RATING_LEVELS = ["low", "medium", "high"] as const;
export type RatingLevel = (typeof RATING_LEVELS)[number];
export const RATING_DIMENSIONS = ["risk", "effort"] as const;
export type RatingDimension = (typeof RATING_DIMENSIONS)[number];
export type SeedRatings = Partial<Record<RatingDimension, RatingLevel>>;
export type SeedMetadata = { name: string | null } & SeedRatings;
export type SeedMetadataRejection = {
  ok: false;
  reason: "invalid-rating";
  field: RatingDimension;
  value: string;
  message: string;
};
export type SeedMetadataResult = { ok: true; metadata: SeedMetadata } | SeedMetadataRejection;

/** The level named by `value`, or `undefined` when it is not on the scale (exact, lowercase match after trimming). */
export function parseRatingLevel(value: string): RatingLevel | undefined {
  const trimmed = value.trim();
  return RATING_LEVELS.find((level) => level === trimmed);
}

function isRatingDimension(key: string): key is RatingDimension {
  return (RATING_DIMENSIONS as readonly string[]).includes(key);
}

function frontmatterFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return fields;
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    const match = /^(\w+):\s*(.*?)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) fields.set(match[1], match[2]);
  }
  return fields;
}

/**
 * Parses a seed's frontmatter. No frontmatter, or frontmatter without ratings, parses fine (ratings absent);
 * a supplied rating outside `RATING_LEVELS` rejects by field name.
 */
export function parseSeedMetadata(text: string): SeedMetadataResult {
  const fields = frontmatterFields(text);
  const name = fields.get("name");
  const metadata: SeedMetadata = { name: name !== undefined && name.length > 0 ? name : null };
  for (const [key, value] of fields) {
    if (!isRatingDimension(key)) continue;
    const level = parseRatingLevel(value);
    if (level === undefined) {
      return {
        ok: false,
        reason: "invalid-rating",
        field: key,
        value,
        message: `seed frontmatter \`${key}:\` must be one of ${RATING_LEVELS.join(", ")}; got ${JSON.stringify(value)}`,
      };
    }
    metadata[key] = level;
  }
  return { ok: true, metadata };
}

import { describe, expect, test } from "bun:test";
import { projectSafeId } from "./project-safe-id.ts";

describe("projectSafeId", () => {
  test("creates stable storage-safe project IDs", () => {
    expect(projectSafeId("org/repo")).toBe("org-repo");
    expect(projectSafeId("///org/repo///")).toBe("org-repo");
    expect(projectSafeId("Org_REPO")).toBe("Org_REPO");
    expect(projectSafeId("///")).toBe("project");
  });
});

import { describe, expect, it } from "bun:test";

describe("Coverage scripts", () => {
  it("coverage:* scripts use exact command strings", async () => {
    const pkgJsonText = await Bun.file("package.json").text();
    const pkgJson = JSON.parse(pkgJsonText);
    expect(pkgJson.scripts.coverage).toBe("bun test --coverage");
    expect(pkgJson.scripts["coverage:v1"]).toBe("bun test --coverage ./v1/");
    expect(pkgJson.scripts["coverage:v2"]).toBe("bun test --coverage ./v2/");
    expect(pkgJson.scripts["coverage:shared"]).toBe(
      "bun test --coverage ./shared/ ./scripts/ ./test/",
    );
  });
});

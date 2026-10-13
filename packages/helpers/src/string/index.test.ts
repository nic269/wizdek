import { describe, expect, it } from "vitest";
import { slugify } from "./index";

describe("slugify", () => {
  it("normalizes strings into URL-safe slugs", () => {
    expect(slugify("Anh Nguyen SaaS Boilerplate")).toBe(
      "anh-nguyen-saas-boilerplate"
    );
  });
});

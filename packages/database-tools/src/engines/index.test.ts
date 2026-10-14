import { describe, expect, it } from "vitest";
import { DatabaseToolsError } from "../errors";
import { resolveAdapter } from ".";

describe("resolveAdapter", () => {
  it("picks PostgreSQL for both of its schemes", () => {
    expect(resolveAdapter("postgresql://u:p@h/d").engine).toBe("POSTGRESQL");
    expect(resolveAdapter("  POSTGRES://u:p@h/d").engine).toBe("POSTGRESQL");
  });

  it("names an unsupported scheme without echoing the URL", () => {
    for (const url of ["mysql://root:secret@h/d", "mongodb://u:secret@h/d"]) {
      try {
        resolveAdapter(url);
        throw new Error("expected a rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseToolsError);
        const { failure, message } = error as DatabaseToolsError;
        expect(failure).toBe("UNSUPPORTED_ENGINE");
        expect(message).toContain("PostgreSQL");
        expect(message).not.toContain("secret");
      }
    }
  });

  it("rejects text that is not a URL", () => {
    expect(() => resolveAdapter("localhost:5432/db")).toThrow(
      DatabaseToolsError
    );
    expect(() => resolveAdapter("just words")).toThrow(
      "must start with a scheme"
    );
  });
});

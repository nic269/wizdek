import { describe, expect, it } from "vitest";
import { createLogger } from "./index";

describe("createLogger", () => {
  it("creates child loggers", () => {
    expect(
      createLogger({ requestId: "req_1" }).child({ userId: "user_1" })
    ).toBeDefined();
  });
});

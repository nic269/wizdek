import { afterEach, describe, expect, it, vi } from "vitest";
import { keys } from "./keys";

describe("mail keys", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a private development outbox directory", () => {
    vi.stubEnv("MAIL_OUTBOX_DIR", "/tmp/wizloft-mail");

    expect(keys().MAIL_OUTBOX_DIR).toBe("/tmp/wizloft-mail");
  });
});

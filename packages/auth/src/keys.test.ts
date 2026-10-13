import { afterEach, describe, expect, it, vi } from "vitest";
import { keys } from "./keys";

describe("auth keys", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats empty optional provider credentials as missing", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3002/api/auth");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_WEB_URL", "http://localhost:3001");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");

    const env = keys();

    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });
});

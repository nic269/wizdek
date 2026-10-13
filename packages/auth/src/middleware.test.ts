import { describe, expect, it } from "vitest";
import { createAuthGuard } from "./middleware";

const guard = createAuthGuard({ dashboard: "/dashboard", signIn: "/sign-in" });

describe("createAuthGuard", () => {
  it("redirects protected routes without a Better Auth session cookie", () => {
    const request = new Request("http://localhost:3000/dashboard");
    const response = guard(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/sign-in"
    );
  });

  it("allows protected routes with a development session cookie", () => {
    const request = new Request("http://localhost:3000/dashboard", {
      headers: { cookie: "better-auth.session_token=session-token" },
    });
    const response = guard(request);

    expect(response.status).toBe(200);
  });

  it("allows protected routes with a secure production session cookie", () => {
    const request = new Request("https://app.example.com/dashboard/settings", {
      headers: { cookie: "__Secure-better-auth.session_token=session-token" },
    });
    const response = guard(request);

    expect(response.status).toBe(200);
  });

  it("guards additional prefixes without matching lookalike paths", () => {
    const extended = createAuthGuard({
      dashboard: "/dashboard",
      protectedPrefixes: ["/stores", "/flows"],
      signIn: "/sign-in",
    });
    const visit = (path: string) =>
      extended(new Request(`http://localhost:3000${path}`)).status;

    expect(visit("/stores")).toBe(307);
    expect(visit("/stores/new")).toBe(307);
    expect(visit("/flows/abc")).toBe(307);
    expect(visit("/storefront")).toBe(200);
    expect(visit("/sign-in")).toBe(200);
  });
});

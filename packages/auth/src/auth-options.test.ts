import { appConfig } from "@repo/config";
import { sendMail } from "@repo/mail";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthOptions,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} from "./auth-options";

vi.mock("@repo/database", () => ({
  prisma: {},
}));

vi.mock("better-auth/adapters/prisma", () => ({
  prismaAdapter: vi.fn(() => ({ id: "prisma-adapter" })),
}));

vi.mock("@repo/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/mail")>();

  return {
    ...actual,
    sendMail: vi.fn(),
  };
});

const env = {
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3002",
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_WEB_URL: "http://localhost:3001",
};

const user = {
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  email: "user@example.com",
  emailVerified: false,
  id: "user-1",
  image: null,
  name: "User",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("auth options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wires password reset delivery through shared mail templates", async () => {
    vi.mocked(sendMail).mockResolvedValue({
      id: "mail-1",
      provider: "console",
    });

    await sendPasswordResetEmail({
      url: "http://localhost:3000/reset-password/token",
      user,
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: `Reset your ${appConfig.name} password`,
        text: expect.stringContaining(
          "http://localhost:3000/reset-password/token"
        ),
        to: "user@example.com",
      })
    );
  });

  it("wires email verification delivery through shared mail templates", async () => {
    vi.mocked(sendMail).mockResolvedValue({
      id: "mail-2",
      provider: "console",
    });

    await sendEmailVerificationEmail({
      url: "http://localhost:3000/verify-email/token",
      user,
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: `Verify your ${appConfig.name} email`,
        text: expect.stringContaining(
          "http://localhost:3000/verify-email/token"
        ),
        to: "user@example.com",
      })
    );
  });

  it("exposes Better Auth callbacks for reset and verification emails", async () => {
    vi.mocked(sendMail).mockResolvedValue({
      id: "mail-3",
      provider: "console",
    });

    const options = createAuthOptions(env);

    await options.emailAndPassword?.sendResetPassword?.({
      token: "reset-token",
      url: "http://localhost:3002/api/auth/reset-password/token",
      user,
    });
    await options.emailVerification?.sendVerificationEmail?.({
      token: "verify-token",
      url: "http://localhost:3002/api/auth/verify-email?token=verify-token",
      user,
    });

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: expect.stringContaining(
          "http://localhost:3000/api/auth/reset-password/token"
        ),
      })
    );
    expect(sendMail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: expect.stringContaining(
          "http://localhost:3000/api/auth/verify-email?token=verify-token"
        ),
      })
    );
    expect(options.emailVerification?.sendOnSignUp).toBe(true);
    expect(options.emailVerification?.autoSignInAfterVerification).toBe(true);
    expect(options.emailAndPassword?.requireEmailVerification).toBe(true);
    expect(options.emailAndPassword?.resetPasswordTokenExpiresIn).toBe(60 * 60);
    expect(options.emailVerification?.expiresIn).toBe(60 * 60);
  });

  it("omits disabled auth delivery callbacks", () => {
    const options = createAuthOptions(env, {
      organizationInvitations: false,
      passwordReset: false,
      requireEmailVerification: false,
    });

    expect(options.emailAndPassword?.sendResetPassword).toBeUndefined();
    expect(options.emailAndPassword?.requireEmailVerification).toBe(false);
    expect(options.emailVerification?.sendOnSignUp).toBe(false);
    expect(options.emailVerification?.sendVerificationEmail).toBeUndefined();
  });
});

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertMailProviderConfiguration,
  consoleMailProvider,
  getMailProviderStatus,
  MailConfigurationError,
  sendMail,
} from "./send";

describe("mail provider", () => {
  let outboxRoot: string;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    outboxRoot = await mkdtemp(join(tmpdir(), "wizloft-mail-outbox-"));
    vi.stubEnv("MAIL_OUTBOX_DIR", outboxRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(outboxRoot, { force: true, recursive: true });
  });

  it("uses console delivery when provider credentials are absent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const status = getMailProviderStatus();

    const delivery = await sendMail({
      subject: "Hello",
      text: "Body",
      to: "user@example.com",
    });
    expect(delivery).toMatchObject({
      provider: "console",
    });
    const files = await readdir(outboxRoot);
    expect(files).toHaveLength(1);
    const message = JSON.parse(
      await readFile(join(outboxRoot, files[0] as string), "utf8")
    ) as Record<string, unknown>;
    expect(message).toMatchObject({
      subject: "Hello",
      text: "Body",
      to: "user@example.com",
    });
    expect(message.id).toBe(delivery.id);
    expect(message).not.toHaveProperty("react");
    expect(message).not.toHaveProperty("html");
    expect(status).toEqual({
      configured: false,
      mode: "development",
      provider: "console",
      state: "disabled",
    });
  });

  it.each([
    {
      field: "Mail subject",
      input: {
        subject: "Hello\r\nBcc: attacker@example.com",
        to: "user@example.com",
      },
    },
    {
      field: "Mail recipient",
      input: {
        subject: "Hello",
        to: "user@example.com\nBcc: attacker@example.com",
      },
    },
    {
      field: "Mail sender",
      input: {
        from: "sender@example.com\r\nBcc: attacker@example.com",
        subject: "Hello",
        to: "user@example.com",
      },
    },
  ])("rejects line breaks in $field before delivery", async ({
    field,
    input,
  }) => {
    expect(() => sendMail(input)).toThrow(
      `${field} contains an invalid line break.`
    );
    expect(await readdir(outboxRoot)).toEqual([]);
  });

  it("rejects unsafe headers through the public raw provider", async () => {
    expect(() =>
      consoleMailProvider.send({
        subject: "Hello\r\nBcc: attacker@example.com",
        to: "user@example.com",
      })
    ).toThrow("Mail subject contains an invalid line break.");
    expect(await readdir(outboxRoot)).toEqual([]);
  });

  it("reports resend as configured only when a sender is present", () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    expect(getMailProviderStatus()).toEqual({
      configured: false,
      message: "resend mail configuration is missing: RESEND_FROM_EMAIL.",
      mode: "provider",
      provider: "resend",
      state: "misconfigured",
    });

    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@example.com");
    expect(getMailProviderStatus()).toEqual({
      configured: true,
      mode: "provider",
      provider: "resend",
      state: "configured",
    });
  });

  it("fails fast on partial resend configuration in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "");

    expect(() => assertMailProviderConfiguration()).toThrow(
      MailConfigurationError
    );
  });

  it("rejects console delivery when production features require mail", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MAIL_PROVIDER", "console");

    expect(() => assertMailProviderConfiguration({ required: true })).toThrow(
      "A real mail provider is required"
    );
  });

  it("reports complete smtp configuration", () => {
    vi.stubEnv("MAIL_PROVIDER", "smtp");
    vi.stubEnv("SMTP_URL", "smtp://user:password@localhost:1025");
    vi.stubEnv("SMTP_FROM_EMAIL", "noreply@example.com");

    expect(getMailProviderStatus()).toEqual({
      configured: true,
      mode: "provider",
      provider: "smtp",
      state: "configured",
    });
  });
});

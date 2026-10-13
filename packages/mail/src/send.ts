import { logger } from "@repo/logger";
import type { ReactElement } from "react";
import { writeDevOutboxMessage } from "./dev-outbox";
import { keys } from "./keys";

const HEADER_LINE_BREAK_PATTERN = /[\r\n]/;

export interface SendMailInput {
  from?: string;
  react?: ReactElement;
  subject: string;
  text?: string;
  to: string;
}

export interface MailProvider {
  send(input: SendMailInput): Promise<{ id: string; provider: string }>;
}

export interface MailProviderStatus {
  configured: boolean;
  message?: string;
  mode: "development" | "provider";
  provider: "console" | "resend" | "smtp";
  state: "configured" | "disabled" | "misconfigured";
}

const assertSafeHeader = (value: string, field: string) => {
  if (HEADER_LINE_BREAK_PATTERN.test(value)) {
    throw new Error(`${field} contains an invalid line break.`);
  }
};

const assertSafeMailHeaders = (input: SendMailInput) => {
  assertSafeHeader(input.subject, "Mail subject");
  assertSafeHeader(input.to, "Mail recipient");
  if (input.from) {
    assertSafeHeader(input.from, "Mail sender");
  }
};

const withSafeMailHeaders = (provider: MailProvider): MailProvider => ({
  send(input) {
    assertSafeMailHeaders(input);
    return provider.send(input);
  },
});

export class MailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigurationError";
  }
}

export const consoleMailProvider: MailProvider = withSafeMailHeaders({
  async send(input) {
    const env = keys();
    const message = await writeDevOutboxMessage(
      input,
      env.MAIL_OUTBOX_DIR ?? ".data/mail"
    );
    logger.info("mail.console", {
      id: message.id,
      outboxPath: message.path,
      subject: input.subject,
      to: input.to,
    });
    return { id: message.id, provider: "console" };
  },
});

const resolveMailProvider = (env: ReturnType<typeof keys>) => {
  if (env.MAIL_PROVIDER) {
    return env.MAIL_PROVIDER;
  }
  if (env.RESEND_API_KEY || env.RESEND_FROM_EMAIL) {
    return "resend";
  }
  if (env.SMTP_URL || env.SMTP_FROM_EMAIL) {
    return "smtp";
  }
  return "console";
};

export const getMailProviderStatus = (): MailProviderStatus => {
  const env = keys();
  const provider = resolveMailProvider(env);

  if (provider === "console") {
    return {
      configured: false,
      mode: "development",
      provider,
      state: "disabled",
    };
  }

  const missing =
    provider === "resend"
      ? [
          ...(env.RESEND_API_KEY ? [] : ["RESEND_API_KEY"]),
          ...(env.RESEND_FROM_EMAIL ? [] : ["RESEND_FROM_EMAIL"]),
        ]
      : [
          ...(env.SMTP_URL ? [] : ["SMTP_URL"]),
          ...(env.SMTP_FROM_EMAIL ? [] : ["SMTP_FROM_EMAIL"]),
        ];

  if (missing.length > 0) {
    return {
      configured: false,
      message: `${provider} mail configuration is missing: ${missing.join(", ")}.`,
      mode: "provider",
      provider,
      state: "misconfigured",
    };
  }

  return { configured: true, mode: "provider", provider, state: "configured" };
};

export const assertMailProviderConfiguration = (
  options: { required?: boolean } = {}
) => {
  const status = getMailProviderStatus();
  if (
    process.env.NODE_ENV === "production" &&
    (status.state === "misconfigured" ||
      (options.required === true && status.state !== "configured"))
  ) {
    throw new MailConfigurationError(
      status.message ??
        "A real mail provider is required by enabled production features."
    );
  }
  return status;
};

export const getMailProvider = (): MailProvider => {
  const env = keys();
  const status = assertMailProviderConfiguration();

  if (status.state !== "configured") {
    return consoleMailProvider;
  }

  if (status.provider === "smtp") {
    return withSafeMailHeaders({
      async send(input) {
        const { createTransport } = await import("nodemailer");
        const { renderToStaticMarkup } = await import("react-dom/server");
        const transport = createTransport(env.SMTP_URL);
        const response = await transport.sendMail({
          from: input.from ?? env.SMTP_FROM_EMAIL,
          html: input.react ? renderToStaticMarkup(input.react) : undefined,
          subject: input.subject,
          text: input.text,
          to: input.to,
        });
        return { id: response.messageId, provider: "smtp" };
      },
    });
  }

  return withSafeMailHeaders({
    async send(input) {
      const { Resend } = await import("resend");
      const resend = new Resend(env.RESEND_API_KEY);
      const emails = resend.emails as unknown as {
        send(
          input: Record<string, unknown>
        ): Promise<{ data?: { id?: string } }>;
      };
      const payload = {
        from: input.from ?? env.RESEND_FROM_EMAIL,
        subject: input.subject,
        to: input.to,
        ...(input.react ? { react: input.react } : {}),
        ...(input.text ? { text: input.text } : {}),
      };
      const response = await emails.send(payload);

      return {
        id: response.data?.id ?? crypto.randomUUID(),
        provider: "resend",
      };
    },
  });
};

export const sendMail = (input: SendMailInput) => {
  assertSafeMailHeaders(input);

  return getMailProvider().send(input);
};

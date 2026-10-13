import {
  type AuthFeatureConfig,
  appConfig,
  authFeatureConfig,
} from "@repo/config";
import { prisma } from "@repo/database";
import { PasswordResetEmail, sendMail, VerificationEmail } from "@repo/mail";
import type { BetterAuthOptions, User } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createElement } from "react";
import { keys } from "./keys";

const APP_NAME = appConfig.name;
const PASSWORD_RESET_SUBJECT = `Reset your ${APP_NAME} password`;
const EMAIL_VERIFICATION_SUBJECT = `Verify your ${APP_NAME} email`;

type AuthEnv = ReturnType<typeof keys>;

interface AuthEmailInput {
  url: string;
  user: User;
}

const useAppAuthOrigin = (url: string, appUrl: string) => {
  const generatedUrl = new URL(url);
  return new URL(
    `${generatedUrl.pathname}${generatedUrl.search}${generatedUrl.hash}`,
    appUrl
  ).toString();
};

export const sendPasswordResetEmail = ({ user, url }: AuthEmailInput) =>
  sendMail({
    react: createElement(PasswordResetEmail, {
      appName: APP_NAME,
      resetUrl: url,
    }),
    subject: PASSWORD_RESET_SUBJECT,
    text: `Use this link to reset your ${APP_NAME} password: ${url}`,
    to: user.email,
  });

export const sendEmailVerificationEmail = ({ user, url }: AuthEmailInput) =>
  sendMail({
    react: createElement(VerificationEmail, {
      appName: APP_NAME,
      verifyUrl: url,
    }),
    subject: EMAIL_VERIFICATION_SUBJECT,
    text: `Use this link to verify your ${APP_NAME} email: ${url}`,
    to: user.email,
  });

export const createAuthOptions = (
  env: AuthEnv = keys(),
  features: AuthFeatureConfig = authFeatureConfig
): BetterAuthOptions => {
  const googleEnabled = Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
  );

  return {
    advanced: {
      database: {
        generateId: false,
      },
    },
    basePath: "/api/auth",
    baseURL: env.BETTER_AUTH_URL,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      autoSignIn: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 8,
      requireEmailVerification: features.requireEmailVerification,
      resetPasswordTokenExpiresIn: 60 * 60,
      ...(features.passwordReset
        ? {
            sendResetPassword: async (data) => {
              await sendPasswordResetEmail({
                ...data,
                url: useAppAuthOrigin(data.url, env.NEXT_PUBLIC_APP_URL),
              });
            },
          }
        : {}),
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendOnSignUp: features.requireEmailVerification,
      ...(features.requireEmailVerification
        ? {
            sendVerificationEmail: async (data) => {
              await sendEmailVerificationEmail({
                ...data,
                url: useAppAuthOrigin(data.url, env.NEXT_PUBLIC_APP_URL),
              });
            },
          }
        : {}),
    },
    secret: env.BETTER_AUTH_SECRET,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID as string,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : undefined,
    trustedOrigins: [env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_WEB_URL],
  };
};

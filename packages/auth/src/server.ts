import { betterAuth } from "better-auth";
import { createAuthOptions } from "./auth-options";

export const auth = betterAuth(createAuthOptions());

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;

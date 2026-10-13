export interface ShopifyOAuthCallbackInput {
  code?: string | undefined;
  hmac?: string | undefined;
  idToken?: string | undefined;
  rawQuery: URLSearchParams;
  shop: string;
  state?: string | undefined;
  timestamp?: string | undefined;
}

export interface ShopifySessionTokenPayload {
  aud: string;
  dest: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  nbf: number;
  sid?: string;
  sig?: string;
  sub: string;
}

export type ShopifyTokenGrant =
  | "authorization-code"
  | "token-exchange"
  | "refresh-token"
  | "client-credentials";

export interface ShopifyTokenResult {
  accessToken: string;
  accessTokenExpiresAt: Date | undefined;
  grant: ShopifyTokenGrant;
  refreshToken: string | undefined;
  refreshTokenExpiresAt: Date | undefined;
  scopes: string[];
}

export interface ShopifyAppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ShopifyTokenRequestOptions {
  fetchImpl?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
}

export interface ShopifyTokenAdapterOptions extends ShopifyTokenRequestOptions {
  /** Request an offline token that expires and comes with a refresh token. */
  expiring?: boolean | undefined;
}

export interface ShopifyTokenAdapter {
  canHandle(input: ShopifyOAuthCallbackInput): boolean;
  exchange(input: ShopifyOAuthCallbackInput): Promise<ShopifyTokenResult>;
  name: ShopifyTokenGrant;
}

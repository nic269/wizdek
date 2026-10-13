export interface AuthFeatureConfig {
  organizationInvitations: boolean;
  passwordReset: boolean;
  requireEmailVerification: boolean;
}

export const authFeatureConfig = {
  organizationInvitations: true,
  passwordReset: true,
  requireEmailVerification: true,
} as const satisfies AuthFeatureConfig;

export const isAuthMailRequired = (features: AuthFeatureConfig) =>
  Object.values(features).some(Boolean);

export const authMailRequired = isAuthMailRequired(authFeatureConfig);

export const featureConfig = {
  analytics: false,
  billing: false,
  cms: false,
  i18n: false,
  jobs: false,
  storage: true,
} as const;

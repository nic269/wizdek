export interface FeatureFlagProvider {
  isEnabled(key: string, context?: Record<string, unknown>): Promise<boolean>;
}

export const staticFlags = (
  flags: Record<string, boolean>
): FeatureFlagProvider => ({
  isEnabled(key) {
    return Promise.resolve(Boolean(flags[key]));
  },
});

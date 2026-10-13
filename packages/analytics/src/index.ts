export interface AnalyticsProvider {
  identify?: (
    userId: string,
    traits?: Record<string, unknown>
  ) => void | Promise<void>;
  track: (
    event: string,
    properties?: Record<string, unknown>
  ) => void | Promise<void>;
}

export const noopAnalytics: AnalyticsProvider = {
  identify: () => undefined,
  track: () => undefined,
};

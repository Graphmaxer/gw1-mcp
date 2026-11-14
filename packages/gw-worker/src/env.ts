/** Minimal shape of the Analytics Engine binding (avoids a types package). */
export interface AnalyticsEngineDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export type AppEnv = {
  Bindings: {
    OPENAI_APPS_CHALLENGE?: string;
    RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    MCP_ANALYTICS?: AnalyticsEngineDataset;
  };
};

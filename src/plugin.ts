import type {
  HyperCore,
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
} from "@hyperttp/core";
import { RateLimiter } from "./utils/RateLimiter.js";
import { RateLimitOptions } from "./types/limiter.js";

export function withRateLimit(
  client: HyperCore,
  options: RateLimitOptions,
): HyperCore {
  const limiter = new RateLimiter(options);
  const next = client.dispatch;
  const originalGetStats = client.getStats.bind(client);

  client.getStats = () => ({
    ...originalGetStats(),
    currentRateLimit: limiter.currentCount ?? 0,
  });

  client.dispatch = async (req: InternalRequest) => {
    await limiter.wait();
    return next(req);
  };

  return client;
}

declare module "@hyperttp/core" {
  interface HyperttpPluginsExtension {
    rateLimit?: RateLimitOptions & { enabled?: boolean };
  }
}

export const RateLimitPlugin: HyperPlugin = {
  name: "hyperttp-ratelimit",
  phase: "CONTROL",
  enabled: (config: HttpClientOptions) => !!config.rateLimit?.enabled,
  apply: (client: HyperCore, config: HttpClientOptions) => {
    return withRateLimit(client, config.rateLimit!);
  },
};

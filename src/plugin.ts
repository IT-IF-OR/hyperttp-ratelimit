import type {
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
  HttpResponse,
} from "@hyperttp/core";
import { RateLimiter } from "./utils/RateLimiter.js";
import { RateLimitOptions } from "./types/limiter.js";

declare module "@hyperttp/core" {
  interface HyperttpPluginsExtension {
    rateLimit?: RateLimitOptions & { enabled?: boolean };
  }
}

export function withRateLimit(
  options?: Partial<RateLimitOptions>,
): HyperPlugin {
  let limiter: RateLimiter;

  return {
    name: "hyperttp-ratelimit",
    phase: "CONTROL",
    enabled: (config: HttpClientOptions) => !!config.rateLimit?.enabled,

    setup(core, config) {
      const finalOptions = {
        ...config.rateLimit,
        ...options,
      } as RateLimitOptions;

      limiter = new RateLimiter(finalOptions);

      const originalGetStats = core.getStats.bind(core);
      core.getStats = () => ({
        ...originalGetStats(),
        currentRateLimit: limiter.currentCount ?? 0,
      });
    },

    wrapDispatch: (next) => {
      return async <T>(req: InternalRequest): Promise<HttpResponse<T>> => {
        await limiter.wait(1, req.signal);
        return next<T>(req);
      };
    },
  };
}

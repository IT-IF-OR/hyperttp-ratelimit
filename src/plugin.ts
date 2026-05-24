import type {
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
  HttpResponse,
  PluginContext,
} from "@hyperttp/core";
import { RateLimiter } from "./utils/RateLimiter.js";
import type { RateLimitOptions } from "./types/limiter.js";

declare module "@hyperttp/core" {
  interface PluginContext {
    rateLimiter?: RateLimiter;
  }
  interface HttpClientOptions {
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

    setup(ctx: PluginContext) {
      const { core, config } = ctx as any;

      const finalOptions = {
        ...config?.rateLimit,
        ...options,
        enabled: true,
      } as RateLimitOptions;

      limiter = new RateLimiter(finalOptions);
      ctx.rateLimiter = limiter;

      if (core && typeof core.getStats === "function") {
        const originalGetStats = core.getStats;
        core.getStats = function (this: any) {
          const stats = originalGetStats.call(this);
          if (stats) {
            (stats as any).currentRateLimit = limiter.currentCount ?? 0;
          }
          return stats;
        };
      }
    },

    wrapDispatch: (next) => {
      return <T>(req: InternalRequest): Promise<HttpResponse<T>> => {
        try {
          const maybePromise = limiter.wait(1, req.signal);

          if (maybePromise === null) {
            return next<T>(req);
          }

          return maybePromise.then(() => next<T>(req));
        } catch (err) {
          return Promise.reject(err);
        }
      };
    },
  };
}

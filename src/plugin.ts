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

          const execute = () =>
            next<T>(req).then((res) => {
              if (res.status === 429) {
                const retryAfter = res.headers.get("retry-after");
                const delay = retryAfter
                  ? parseInt(retryAfter, 10) * 1000
                  : 2000;

                limiter.penalize(delay);
              }
              return res;
            });

          if (maybePromise === null) {
            return execute();
          }

          return maybePromise.then(execute);
        } catch (err) {
          return Promise.reject(err);
        }
      };
    },
  };
}

import type {
  HyperPlugin,
  HyperClientOptions,
  UniversalResponse,
  PluginContext,
  SendRequest,
  RequestContext,
  IHyperCore,
} from "@hyperttp/types";
import { RateLimiter } from "./utils/RateLimiter.js";
import type { RateLimitOptions } from "./types/limiter.js";

declare module "@hyperttp/types" {
  interface HyperClientOptions {
    rateLimit?: RateLimitOptions;
  }

  interface PluginContext {
    rateLimiter?: RateLimiter;
  }
}

function getHeader(
  headers: Readonly<Record<string, string | string[]>> | undefined,
  name: string,
): string | string[] | undefined {
  if (!headers) return undefined;
  const lookup = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lookup) return value;
  }
  return undefined;
}

function retryAfterPenalty(response?: UniversalResponse): number {
  const retryAfterHeader = response && getHeader(response.headers, "retry-after");
  const retryAfter = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : 2000;
}

function defaultResponsePenalty(response: UniversalResponse): number | false {
  return response.protocol === "rest" && response.status === 429
    ? retryAfterPenalty(response)
    : false;
}

function defaultErrorPenalty(error: unknown): number | false {
  const target = error as Record<string, unknown> | null;
  const response = target?.response as UniversalResponse | undefined;
  const status = target?.status ?? target?.statusCode ?? response?.status;
  if (status !== 429) return false;
  if (response && response.protocol !== "rest") return false;
  return retryAfterPenalty(response);
}

function applyPenalty(limiter: RateLimiter, decision: number | false | null | undefined): void {
  if (typeof decision === "number" && Number.isFinite(decision) && decision >= 0) {
    limiter.penalize(decision);
  }
}

export function withRateLimit(options?: Partial<RateLimitOptions>): HyperPlugin {
  let limiter: RateLimiter;
  let finalOptions: RateLimitOptions;

  return {
    name: "hyperttp-ratelimit",
    enabled: (config: HyperClientOptions): boolean => !!config.rateLimit?.enabled,
    setup(ctx: PluginContext): void {
      finalOptions = {
        ...ctx.config.rateLimit,
        ...options,
        enabled: true,
      } as RateLimitOptions;

      limiter = new RateLimiter(finalOptions);
      const context = ctx as PluginContext & { rateLimiter?: RateLimiter };
      context.rateLimiter = limiter;

      const core = ctx.core as IHyperCore & {
        getStats?: () => Record<string, unknown> & {
          currentRateLimit?: number;
        };
      };
      if (typeof core.getStats === "function") {
        const originalGetStats = core.getStats;
        core.getStats = function () {
          const stats = originalGetStats.call(core);
          if (stats) stats.currentRateLimit = limiter.currentCount;
          return stats;
        };
      }
    },
    async onRequest(
      req: SendRequest,
      _ctx?: PluginContext,
      reqCtx?: RequestContext,
    ): Promise<void> {
      const weight = finalOptions.getRequestWeight
        ? await finalOptions.getRequestWeight(req, reqCtx)
        : 1;
      const maybePromise = limiter.wait(weight, req.signal ?? reqCtx?.signal);
      if (maybePromise) await maybePromise;
    },
    async onResponse(res, req, _ctx, reqCtx): Promise<void> {
      const getPenalty = finalOptions.getResponsePenalty ?? defaultResponsePenalty;
      applyPenalty(limiter, await getPenalty(res, req, reqCtx));
    },
    async onError(err, req, _ctx, reqCtx): Promise<void> {
      const getPenalty = finalOptions.getErrorPenalty ?? defaultErrorPenalty;
      applyPenalty(limiter, await getPenalty(err, req, reqCtx));
    },
  };
}

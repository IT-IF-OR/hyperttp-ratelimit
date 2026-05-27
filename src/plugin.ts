import type {
  HyperPlugin,
  InternalRequest,
  HttpClientOptions,
  HttpResponse,
  PluginContext,
  IHyperCore,
} from "@hyperttp/types";
import { RateLimiter } from "./utils/RateLimiter.js";
import type { RateLimitOptions } from "./types/limiter.js";

declare module "@hyperttp/types" {
  interface PluginContext {
    rateLimiter?: RateLimiter;
  }
  interface HttpClientOptions {
    rateLimit?: RateLimitOptions & { enabled?: boolean };
  }

  interface IHyperCore {
    getStats?: () => Record<string, unknown> & { currentRateLimit?: number };
  }
}

export function withRateLimit(
  options?: Partial<RateLimitOptions>,
): HyperPlugin {
  let limiter: RateLimiter;

  return {
    name: "hyperttp-ratelimit",
    enabled: (config: HttpClientOptions): boolean =>
      !!config.rateLimit?.enabled,

    setup(
      ctx: PluginContext & { core?: IHyperCore; config: HttpClientOptions },
    ): void {
      const finalOptions = {
        ...ctx.config?.rateLimit,
        ...options,
        enabled: true,
      } as RateLimitOptions;

      limiter = new RateLimiter(finalOptions);
      ctx.rateLimiter = limiter;

      if (ctx.core && typeof ctx.core.getStats === "function") {
        const originalGetStats = ctx.core.getStats;

        ctx.core.getStats = function (this: unknown) {
          const stats = originalGetStats.call(this);
          if (stats) {
            stats.currentRateLimit = limiter.currentCount ?? 0;
          }
          return stats;
        };
      }
    },

    /**
     * @ru Перехватчик фазы запроса. Приостанавливает выполнение конвейера, если превышены лимиты (Throttling).
     * @en Request phase interceptor. Suspends pipeline progression if limits are reached (Throttling).
     * @param req - Contextual internal request options.
     */
    async onRequest(req: InternalRequest): Promise<void> {
      const maybePromise = limiter.wait(1, req.signal);
      if (maybePromise instanceof Promise) {
        await maybePromise;
      }
    },

    /**
     * @ru Перехватчик фазы успешного ответа. Анализирует код 429 и накладывает временной штраф на отправку последующих запросов.
     * @en Response phase interceptor. Evaluates 429 codes and inflicts temporary cooldown penalties on subsequent flights.
     * @param res - Output HTTP client response reference.
     */
    onResponse(res: HttpResponse<unknown>): void {
      if (res.status === 429) {
        const retryAfterHeader =
          typeof res.headers?.get === "function"
            ? res.headers.get("retry-after")
            : ((res.headers as Record<string, string | string[] | undefined>)?.[
                "retry-after"
              ] ??
              (res.headers as Record<string, string | string[] | undefined>)?.[
                "Retry-After"
              ]);

        const retryAfter = Array.isArray(retryAfterHeader)
          ? retryAfterHeader[0]
          : retryAfterHeader;
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;

        limiter.penalize(delay);
      }
    },

    /**
     * @ru Перехватчик ошибок конвейера. Дублирует логику штрафа, если сетевой сбой из-за 429 статус-кода был выброшен в виде исключения.
     * @en Error phase interceptor. Duplicates penalization logic if a 429 failure was dispatched as a thrown exception.
     * @param err - Intercepted runtime exception container.
     */
    onError(err: unknown): void {
      const errTarget = err as Record<string, unknown> | null;
      const statusCode = errTarget?.status ?? errTarget?.statusCode;

      if (statusCode === 429) {
        const response = errTarget?.response as
          | HttpResponse<unknown>
          | undefined;
        let delay = 2000;

        if (response?.headers) {
          const retryAfterHeader =
            typeof response.headers.get === "function"
              ? response.headers.get("retry-after")
              : (
                  response.headers as Record<
                    string,
                    string | string[] | undefined
                  >
                )?.["retry-after"];

          const retryAfter = Array.isArray(retryAfterHeader)
            ? retryAfterHeader[0]
            : retryAfterHeader;
          if (retryAfter) {
            delay = parseInt(retryAfter, 10) * 1000;
          }
        }

        limiter.penalize(delay);
      }
    },
  };
}

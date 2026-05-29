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
  interface HyperttpPluginsExtension {
    rateLimit?: RateLimitOptions & { enabled?: boolean };
  }

  interface PluginContext {
    rateLimiter?: RateLimiter;
  }

  interface IHyperCore {
    getStats?(): Record<string, unknown> & { currentRateLimit?: number };
  }
}

/**
 * @en Retrieves a header value from headers object, supporting both Map and plain object.
 * @ru Получает заголовок из объекта headers, поддерживая и Map, и обычный объект.
 */
function getHeader(headers: any, name: string): string | string[] | undefined {
  if (typeof headers?.get === "function") {
    return headers.get(name);
  }
  return (
    (headers as Record<string, string | string[] | undefined>)?.[
      name.toLowerCase()
    ] ?? (headers as Record<string, string | string[] | undefined>)?.[name]
  );
}

/**
 * @en Creates a plugin for request rate limiting.
 * @ru Создаёт плагин для ограничения скорости запросов (rate limiting).
 */
export function withRateLimit(
  options?: Partial<RateLimitOptions>,
): HyperPlugin {
  let limiter: RateLimiter;

  return {
    name: "hyperttp-ratelimit",

    /**
     * @en Determines if the plugin is enabled based on client configuration.
     * @ru Определяет, включён ли плагин на основе конфигурации клиента.
     */
    enabled: (config: HttpClientOptions): boolean =>
      !!config.rateLimit?.enabled,

    /**
     * @en Initializes RateLimiter and extends getStats for statistics.
     * @ru Инициализирует RateLimiter и расширяет getStats для статистики.
     */
    setup(
      ctx: PluginContext & { core?: IHyperCore; config: HttpClientOptions },
    ): void {
      const finalOptions = {
        ...ctx.config.rateLimit,
        ...options,
        enabled: true,
      } as RateLimitOptions;

      limiter = new RateLimiter(finalOptions);
      ctx.rateLimiter = limiter;

      if (ctx.core && typeof ctx.core.getStats === "function") {
        const originalGetStats = ctx.core.getStats;

        ctx.core.getStats = function (this: IHyperCore) {
          const stats = originalGetStats.call(this);
          if (stats) {
            stats.currentRateLimit = limiter.currentCount ?? 0;
          }
          return stats;
        };
      }
    },

    /**
     * @en Throttles request pipeline progression if bucket limits are hit.
     * @ru Задерживает выполнение запроса, если превышены лимиты (Throttling).
     */
    async onRequest(req: InternalRequest): Promise<void> {
      const maybePromise = limiter.wait(1, req.signal);
      if (maybePromise instanceof Promise) {
        await maybePromise;
      }
    },

    /**
     * @en Intercepts successful responses. Inflicts cooling penalty on upstream 429 status.
     * @ru Перехватывает успешные ответы. При статусе 429 накладывает штрафной таймаут.
     */
    onResponse(res: HttpResponse<unknown>): void {
      if (res.status === 429) {
        const retryAfterHeader = getHeader(res.headers, "retry-after");

        const retryAfter = Array.isArray(retryAfterHeader)
          ? retryAfterHeader[0]
          : retryAfterHeader;
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;

        limiter.penalize(delay);
      }
    },

    /**
     * @en Duplicates cooling penalty logic if a 429 error is delivered via thrown exception.
     * @ru Дублирует логику штрафа, если 429 ошибка прилетела в виде исключения (HTTP Error).
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
          const retryAfter = getHeader(response.headers, "retry-after");

          const val = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
          if (val) {
            delay = parseInt(val, 10) * 1000;
          }
        }

        limiter.penalize(delay);
      }
    },
  };
}

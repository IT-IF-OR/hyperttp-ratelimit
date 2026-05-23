export interface RateLimitOptions {
  /**
   * @ru Включить rate limit
   * @en Enable rate limiting
   */
  enabled?: boolean;
  /**
   * @ru Максимальное число запросов
   * @en Maximum number of requests
   */
  maxRequests?: number;

  /**
   * @ru Окно времени (мс)
   * @en Time window in milliseconds
   */
  windowMs?: number;
}

export type WaiterNode = {
  tokensNeeded: number;
  resolve: () => void;
  reject: (reason?: unknown) => void;
  next: WaiterNode | null;
  cancelled?: boolean;
};

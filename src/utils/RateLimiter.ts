import type { RateLimitOptions, WaiterNode } from "../types/limiter.js";

/**
 * @class RateLimiter
 * @en Token bucket rate limiter with a high-performance FIFO wait queue and object pooling.
 * @ru Ограничитель интенсивности (Rate Limiter) на базе алгоритма Token Bucket с FIFO-очередью и пулом объектов.
 */
export class RateLimiter {
  /** @private */
  private readonly enabled: boolean;
  /** @private */
  private readonly max: number;
  /** @private */
  private readonly window: number;
  /** @private */
  private readonly refillRate: number;

  /** @private */
  private tokens: number;
  /** @private */
  private lastRefill: number;

  /** @private */
  private head: WaiterNode | null = null;
  /** @private */
  private tail: WaiterNode | null = null;

  /** @private */
  private pool: WaiterNode[] = [];
  /** @private */
  private poolSize = 0;
  /** @private */
  private readonly maxPoolSize = 10000;

  /** @private */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** @private */
  private lockedUntil = 0;

  constructor(config?: RateLimitOptions) {
    this.enabled = config?.enabled ?? false;

    const maxReq = config?.maxRequests ? config.maxRequests | 0 : 100;
    const winMs = config?.windowMs ? config.windowMs | 0 : 60_000;

    this.max = maxReq < 1 ? 1 : maxReq;
    this.window = winMs < 1 ? 1 : winMs;

    this.refillRate = this.max / this.window;
    this.tokens = this.max;
    this.lastRefill = Date.now();
  }

  /**
   * @ru Запрашивает токены на выполнение операции. Если лимиты исчерпаны, возвращает Promise,
   * который разрешится, когда bucket пополнится до нужного объема.
   * @en Requests execution tokens. If limits are exhausted, returns a Promise
   * that resolves once the bucket accumulates the required capacity.
   * @param tokensNeeded - Number of tokens to consume (defaults to 1).
   * @param signal - Optional AbortSignal to cancel pending queue state.
   */
  public wait(tokensNeeded = 1, signal?: AbortSignal): Promise<void> | null {
    if (!this.enabled) return null;

    if (signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }

    tokensNeeded = tokensNeeded | 0;
    if (tokensNeeded < 1) tokensNeeded = 1;
    if (tokensNeeded > this.max) tokensNeeded = this.max;

    this.refill();

    if (this.head === null && this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded;
      return null;
    }

    return new Promise<void>((resolve, reject) => {
      let node: WaiterNode;

      if (this.poolSize > 0) {
        node = this.pool[--this.poolSize];
        node.tokensNeeded = tokensNeeded;
        node.resolve = resolve;
        node.reject = reject;
        node.next = null;
        node.cancelled = false;
      } else {
        node = { tokensNeeded, resolve, reject, next: null, cancelled: false };
      }

      if (signal) {
        const onAbort = () => {
          node.cancelled = true;
          if (this.head === node) {
            this.clearTimer();
            this.drainQueue();
          }
          if (node.reject) {
            node.reject(
              new DOMException("The user aborted a request.", "AbortError"),
            );
          }
          signal.removeEventListener("abort", onAbort);
        };
        signal.addEventListener("abort", onAbort);

        const originalResolve = node.resolve;
        node.resolve = () => {
          signal.removeEventListener("abort", onAbort);
          if (originalResolve) originalResolve();
        };
      }

      if (this.tail !== null) {
        this.tail.next = node;
      } else {
        this.head = node;
      }
      this.tail = node;

      this.scheduleDrain();
    });
  }

  /**
   * @ru Пытается немедленно потребить указанное число токенов без ожидания в очереди.
   * @en Attempts to consume the specified amount of tokens immediately without queueing.
   * @param tokensNeeded - Target allocation size.
   * @returns Successful consumption confirmation indicator.
   */
  public tryConsume(tokensNeeded = 1): boolean {
    if (!this.enabled) return true;

    tokensNeeded = tokensNeeded | 0;
    if (tokensNeeded < 1) tokensNeeded = 1;
    if (tokensNeeded > this.max) tokensNeeded = this.max;

    this.refill();

    if (this.head === null && this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded;
      return true;
    }

    return false;
  }

  /**
   * @private
   * @ru Пересчитывает баланс токенов в корзине на основе дельты времени.
   * @en Evaluates and applies granular token replenishment based on time elapsed.
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;

    if (elapsedMs > 0) {
      this.tokens += elapsedMs * this.refillRate;
      if (this.tokens > this.max) this.tokens = this.max;
      this.lastRefill = now;
    }
  }

  /**
   * @private
   * @ru Продвигает очередь ожидания, разрешая промисы по мере пополнения пула токенов.
   * @en Progresses the waiting queue, resolving pending hooks as token volume recovers.
   */
  private drainQueue(): void {
    this.timer = null;
    this.refill();

    while (this.head !== null) {
      const next = this.head;

      if (next.cancelled) {
        this.head = next.next;
        if (this.head === null) this.tail = null;
        this.releaseNode(next);
        continue;
      }

      if (this.tokens < next.tokensNeeded) {
        break;
      }

      this.tokens -= next.tokensNeeded;
      this.head = next.next;
      if (this.head === null) this.tail = null;

      if (next.resolve) next.resolve();
      this.releaseNode(next);
    }

    if (this.head !== null) {
      this.scheduleDrain();
    }
  }

  /**
   * @private
   * @ru Зануляет ссылки внутри ноды и возвращает её в пул для повторного использования.
   * @en Flushes active closures from the node structure and returns it to the recycle array.
   */
  private releaseNode(node: WaiterNode): void {
    node.resolve = null;
    node.reject = null;
    node.next = null;

    if (this.poolSize < this.maxPoolSize) {
      this.pool[this.poolSize++] = node;
    }
  }

  /**
   * @private
   * @ru Сбрасывает текущий активный таймер планировщика сброса очереди.
   * @en Clears out the current active timer instance guiding pipeline drainage.
   */
  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * @private
   * @ru Вычисляет необходимое время ожидания для головной ноды очереди и заводит таймер.
   * @en Estimates delay step required by the leading queue node and provisions the scheduling task.
   */
  private scheduleDrain(): void {
    if (this.timer !== null) return;

    while (this.head !== null && this.head.cancelled) {
      const next = this.head;
      this.head = next.next;
      if (this.head === null) this.tail = null;
      this.releaseNode(next);
    }

    if (this.head === null) return;

    const needed = this.head.tokensNeeded - this.tokens;
    if (needed <= 0) {
      this.drainQueue();
      return;
    }

    const now = Date.now();
    let waitMs = needed / this.refillRate;

    if (now < this.lockedUntil) {
      const lockRemaining = this.lockedUntil - now;
      if (lockRemaining > waitMs) waitMs = lockRemaining;
    }

    waitMs = (waitMs | 0) + (waitMs % 1 > 0 ? 1 : 0);

    this.timer = setTimeout(() => this.drainQueue(), waitMs < 1 ? 1 : waitMs);
  }

  /**
   * @ru Количество доступных запросов (целых токенов), оставшихся в корзине на текущий момент.
   * @en Total integer token units currently available inside the bucket.
   */
  public get remainingRequests(): number {
    if (!this.enabled) return Number.POSITIVE_INFINITY;
    this.refill();
    return this.tokens | 0;
  }

  /**
   * @ru Текущее количество израсходованных токенов в текущем временном окне.
   * @en The count of consumed tokens out of the max limit in the current frame.
   */
  public get currentCount(): number {
    if (!this.enabled) return 0;
    this.refill();
    const count = this.max - this.tokens;
    return count < 0 ? 0 : count | 0;
  }

  /**
   * @ru Время (в мс) до момента, когда в корзине появится хотя бы один целый токен.
   * @en Remaining delay (ms) until at least one integer token capacity slot is fully regenerated.
   */
  public get timeToReset(): number {
    if (!this.enabled) return 0;
    this.refill();
    if (this.tokens >= 1) return 0;

    const deficit = 1 - this.tokens;
    const waitMs = deficit / this.refillRate;
    return (waitMs | 0) + (waitMs % 1 > 0 ? 1 : 0);
  }

  /**
   * @ru Принудительно обнуляет токены и блокирует обработку на штрафной интервал.
   * Полезно при получении внешнего ответа 429 Too Many Requests со стороны upstream.
   * @en Enforces full token starvation and suspends queue execution for a penalty frame duration.
   * Useful when intercepting 429 Too Many Requests responses emitted from upstream endpoints.
   * @param durationMs - Penalty cooling cooldown length.
   */
  public penalize(durationMs: number): void {
    if (!this.enabled) return;

    this.tokens = 0;
    this.lockedUntil = Date.now() + durationMs;

    this.clearTimer();
    this.scheduleDrain();
  }

  /**
   * @ru Сбрасывает состояние лимитера, отклоняя все ожидающие в очереди запросы с ошибкой.
   * @en Flushes core limiter variables, rejecting all stacked pipeline wait nodes with an error.
   */
  public reset(): void {
    const error = new Error("Rate limiter has been reset");
    let current = this.head;
    this.head = null;
    this.tail = null;

    while (current !== null) {
      const next = current.next;
      if (!current.cancelled && current.reject) {
        current.reject(error);
      }
      this.releaseNode(current);
      current = next;
    }

    this.tokens = this.max;
    this.lastRefill = Date.now();
    this.clearTimer();
  }
}

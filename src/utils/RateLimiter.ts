import type { RateLimitOptions, WaiterNode } from "../types/limiter";

/**
 * @class RateLimiter
 * @en Token bucket rate limiter with FIFO wait queue.
 * @ru Rate limiter на основе token bucket с FIFO-очередью ожидания.
 */
export class RateLimiter {
  private readonly enabled: boolean;
  private readonly max: number;
  private readonly window: number;
  private readonly refillRate: number;

  private tokens: number;
  private lastRefill: number;

  private head: WaiterNode | null = null;
  private tail: WaiterNode | null = null;

  private pool: WaiterNode[] = [];
  private poolSize = 0;
  private readonly maxPoolSize = 10000;

  private timer: ReturnType<typeof setTimeout> | null = null;

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
   * @en Waits until enough tokens are available and consumes them.
   * @ru Ждёт появления достаточного числа токенов и потребляет их.
   */
  async wait(tokensNeeded = 1, signal?: AbortSignal): Promise<void> {
    if (!this.enabled) return;

    // Если запрос УЖЕ отменён, даже не встаём в очередь
    if (signal?.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }

    tokensNeeded = tokensNeeded | 0;
    if (tokensNeeded < 1) tokensNeeded = 1;
    if (tokensNeeded > this.max) tokensNeeded = this.max;

    this.refill();

    if (this.head === null && this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded;
      return;
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
          reject(new DOMException("The user aborted a request.", "AbortError"));
          signal.removeEventListener("abort", onAbort);
        };
        signal.addEventListener("abort", onAbort);

        const originalResolve = node.resolve;
        node.resolve = () => {
          signal.removeEventListener("abort", onAbort);
          originalResolve();
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
   * @en Attempts to consume tokens immediately.
   * @ru Пытается немедленно потребить токены.
   */
  tryConsume(tokensNeeded = 1): boolean {
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
   * @en Internal method to refill the bucket based on elapsed time.
   * @ru Внутренний метод пополнения корзины на основе прошедшего времени.
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;

    if (elapsedMs > 0) {
      this.tokens += elapsedMs * this.refillRate;

      if (this.tokens > this.max) {
        this.tokens = this.max;
      }

      this.lastRefill = now;
    }
  }

  /**
   * @en Processes queued waiters in FIFO order.
   * @ru Обрабатывает ожидающие запросы в FIFO-порядке.
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
      if (this.head === null) {
        this.tail = null;
      }

      next.resolve();
      this.releaseNode(next);
    }

    if (this.head !== null) {
      this.scheduleDrain();
    }
  }

  private releaseNode(node: WaiterNode): void {
    node.resolve = null!;
    node.reject = null!;
    node.next = null;

    if (this.poolSize < this.maxPoolSize) {
      this.pool[this.poolSize++] = node;
    }
  }

  /**
   * @en Schedules the next queue drain based on the next token refill time.
   * @ru Планирует следующий проход по очереди с учётом времени до следующего токена.
   */
  private scheduleDrain(): void {
    if (this.timer !== null || this.head === null) return;

    const needed = this.head.tokensNeeded - this.tokens;

    if (needed <= 0) {
      this.drainQueue();
      return;
    }

    let waitMs = needed / this.refillRate;
    waitMs = (waitMs | 0) + (waitMs % 1 > 0 ? 1 : 0);

    this.timer = setTimeout(
      () => {
        this.drainQueue();
      },
      waitMs < 1 ? 1 : waitMs,
    );
  }

  get remainingRequests(): number {
    if (!this.enabled) return Number.POSITIVE_INFINITY;
    this.refill();
    return this.tokens | 0;
  }

  get currentCount(): number {
    if (!this.enabled) return 0;
    this.refill();
    const count = this.max - this.tokens;
    return count < 0 ? 0 : count | 0;
  }

  get timeToReset(): number {
    if (!this.enabled) return 0;
    this.refill();

    if (this.tokens >= 1) return 0;

    const deficit = 1 - this.tokens;
    const waitMs = deficit / this.refillRate;
    return (waitMs | 0) + (waitMs % 1 > 0 ? 1 : 0);
  }

  reset(): void {
    const error = new Error("Rate limiter has been reset");

    let current = this.head;
    this.head = null;
    this.tail = null;

    while (current !== null) {
      const next = current.next;
      current.reject(error);
      this.releaseNode(current);
      current = next;
    }

    this.tokens = this.max;
    this.lastRefill = Date.now();

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

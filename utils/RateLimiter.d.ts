import type { RateLimitOptions } from "../types/limiter.js";
/**
 * @en High-performance token-bucket rate limiter with FIFO queue and object pooling.
 * @ru Высокопроизводительный ограничитель скорости на основе токенов с FIFO-очередью и пулом объектов.
 */
export declare class RateLimiter {
    private readonly enabled;
    private readonly max;
    private readonly window;
    private readonly refillRate;
    private tokens;
    private lastRefill;
    private head;
    private tail;
    private pool;
    private poolSize;
    private readonly maxPoolSize;
    private timer;
    private lockedUntil;
    constructor(config?: RateLimitOptions);
    /**
     * @en Waits until enough tokens are available to proceed. Returns a promise if queued, or null if immediate.
     * @ru Ожидает появления достаточного количества токенов для продолжения. Возвращает обещание, если запрос в очереди, или null, если немедленно.
     * @param tokensNeeded - Number of tokens required for this operation.
     * @param signal - Optional abort signal to cancel the wait.
     * @returns A promise resolving when tokens are available, or null if allowed immediately.
     */
    wait(tokensNeeded?: number, signal?: AbortSignal): Promise<void> | null;
    /**
     * @en Attempts to consume tokens immediately without waiting.
     * @ru Пытается немедленно потребить токены без ожидания.
     * @param tokensNeeded - Number of tokens to consume.
     * @returns True if tokens were consumed successfully, false otherwise.
     */
    tryConsume(tokensNeeded?: number): boolean;
    /**
     * @en Refills tokens based on elapsed time since last refill.
     * @ru Пополняет токены на основе времени, прошедшего с последнего пополнения.
     * @private
     */
    private refill;
    /**
     * @en Processes the FIFO queue, resolving promises for requests that can now proceed.
     * @ru Обрабатывает FIFO-очередь, разрешая обещания для запросов, которые теперь могут выполниться.
     * @private
     */
    private drainQueue;
    /**
     * @en Returns a waiter node to the object pool for reuse.
     * @ru Возвращает узел ожидания в пул объектов для повторного использования.
     * @param node - The node to release.
     * @private
     */
    private releaseNode;
    /**
     * @en Clears the scheduled drain timer.
     * @ru Очищает запланированный таймер обработки очереди.
     * @private
     */
    private clearTimer;
    /**
     * @en Schedules the next queue drain execution based on token availability.
     * @ru Планирует следующее выполнение обработки очереди на основе доступности токенов.
     * @private
     */
    private scheduleDrain;
    /**
     * @en Returns the number of remaining available tokens.
     * @ru Возвращает количество оставшихся доступных токенов.
     */
    get remainingRequests(): number;
    /**
     * @en Returns the number of currently consumed tokens (active load).
     * @ru Возвращает количество текущих потребленных токенов (активная нагрузка).
     */
    get currentCount(): number;
    /**
     * @en Returns the estimated time in milliseconds until at least one token is available.
     * @ru Возвращает предполагаемое время в миллисекундах до появления хотя бы одного токена.
     */
    get timeToReset(): number;
    /**
     * @en Penalizes the limiter by exhausting tokens and locking for a specified duration.
     * @ru Накладывает штраф на ограничитель, исчерпывая токены и блокируя на указанное время.
     * @param durationMs - Duration of the penalty lock in milliseconds.
     */
    penalize(durationMs: number): void;
    /**
     * @en Resets the limiter, clearing the queue and restoring full token capacity.
     * @ru Сбрасывает ограничитель, очищая очередь и восстанавливая полную емкость токенов.
     */
    reset(): void;
}
//# sourceMappingURL=RateLimiter.d.ts.map
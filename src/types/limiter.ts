/**
 * @ru Параметры конфигурации для модуля ограничения интенсивности.
 * @en Setup options guiding rate-limiting plugin behaviour.
 */
export interface RateLimitOptions {
  /**
   * @ru Активировать проверку лимитов.
   * @en Flag enabling rate limit verification tasks.
   */
  enabled?: boolean;

  /**
   * @ru Максимально допустимый объем накопленных токенов в рамках скользящего окна.
   * @en Bound ceiling representing the total concurrent token storage pool size.
   */
  maxRequests?: number;

  /**
   * @ru Размер скользящего окна в миллисекундах для регенерации лимитов.
   * @en Time span value in milliseconds dictating structural limit recharge loops.
   */
  windowMs?: number;
}

/**
 * @ru Элемент FIFO-очереди, представляющий отложенный запрос.
 * @en Linked list wrapper node holding contextual deferred execution handlers.
 */
export interface WaiterNode {
  /**
   * @ru Количество токенов, затребованных для выполнения этого узла.
   * @en Aggregate token consumption weight mapped to this entry.
   */
  tokensNeeded: number;

  /**
   * @ru Функция разблокировки ожидания. Равна `null`, если элемент возвращен в пул.
   * @en Execution context resolution handler callback. Evaluates to `null` if the node is in pool storage.
   */
  resolve: (() => void) | null;

  /**
   * @ru Функция отклонения задачи в очереди. Равна `null`, если элемент возвращен в пул.
   * @en Queue exception dispatch callback hook. Evaluates to `null` if the node is in pool storage.
   */
  reject: ((reason?: unknown) => void) | null;

  /**
   * @ru Ссылка на следующий элемент в связном списке FIFO-очереди.
   * @en Pointer pointing to the trailing linked node structure inside the FIFO chain.
   */
  next: WaiterNode | null;

  /**
   * @ru Флаг отмены/сброса задачи (например, по AbortSignal).
   * @en Life status indicator confirming intentional abort request state.
   */
  cancelled: boolean;
}

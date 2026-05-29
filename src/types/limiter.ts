/**
 * @en Setup options guiding rate-limiting plugin behaviour.
 * @ru Параметры конфигурации для модуля ограничения интенсивности.
 */
export interface RateLimitOptions {
  /**
   * @en Flag enabling rate limit verification tasks.
   * @ru Активировать проверку лимитов.
   */
  enabled?: boolean;

  /**
   * @en Bound ceiling representing the total concurrent token storage pool size.
   * @ru Максимально допустимый объем накопленных токенов в рамках скользящего окна.
   */
  maxRequests?: number;

  /**
   * @en Time span value in milliseconds dictating structural limit recharge loops.
   * @ru Размер скользящего окна в миллисекундах для регенерации лимитов.
   */
  windowMs?: number;
}

/**
 * @en Linked list wrapper node holding contextual deferred execution handlers.
 * @ru Элемент FIFO-очереди, представляющий отложенный запрос.
 */
export interface WaiterNode {
  /**
   * @en Aggregate token consumption weight mapped to this entry.
   * @ru Количество токенов, затребованных для выполнения этого узла.
   */
  tokensNeeded: number;

  /**
   * @en Execution context resolution handler callback. Evaluates to `null` if the node is in pool storage.
   * @ru Функция разблокировки ожидания. Равна `null`, если элемент возвращен в пул.
   */
  resolve: (() => void) | null;

  /**
   * @en Queue exception dispatch callback hook. Evaluates to `null` if the node is in pool storage.
   * @ru Функция отклонения задачи в очереди. Равна `null`, если элемент возвращен в пул.
   */
  reject: ((reason?: unknown) => void) | null;

  /**
   * @en Pointer pointing to the trailing linked node structure inside the FIFO chain.
   * @ru Ссылка на следующий элемент в связном списке FIFO-очереди.
   */
  next: WaiterNode | null;

  /**
   * @en Life status indicator confirming intentional abort request state.
   * @ru Флаг отмены/сброса задачи (например, по AbortSignal).
   */
  cancelled: boolean;
}

export type EventHandler = (...args: unknown[]) => unknown;

export class EventRouter {
  private readonly handlers = new Map<string, EventHandler[]>();

  on(event: string, handler: EventHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  async emit(event: string, ...args: unknown[]): Promise<void> {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of list) {
      try {
        await handler(...args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[pi-mcp-export] handler for "${event}" threw: ${message}\n`);
      }
    }
  }

  handlersOf(event: string): ReadonlyArray<EventHandler> {
    return this.handlers.get(event) ?? [];
  }
}

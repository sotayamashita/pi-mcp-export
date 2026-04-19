export interface ContextUsage {
  input: number;
  output: number;
  total: number;
}

export interface UiHandle {
  notify(message: string, level?: "info" | "warn" | "error"): void;
  setWidget(key: string, content: unknown): void;
  custom<T>(renderer: unknown): Promise<T | undefined>;
}

export interface SessionManagerHandle {
  getSessionId(): string;
  getBranch(): ReadonlyArray<unknown>;
}

export interface ExecuteContext {
  cwd: string;
  signal: AbortSignal;
  hasUI: boolean;
  hasTerminal: boolean;
  ui: UiHandle;
  sessionManager: SessionManagerHandle;
  getContextUsage(): ContextUsage;
  abort(reason?: string): void;
}

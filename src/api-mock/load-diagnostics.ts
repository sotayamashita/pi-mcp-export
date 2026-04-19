export type LoadDiagnostic =
  | {
      readonly kind: "unsupported-event";
      readonly event: string;
      readonly reason: string;
    }
  | {
      readonly kind: "unknown-event";
      readonly event: string;
    }
  | {
      readonly kind: "unsupported-api";
      readonly api: string;
      readonly meta?: Readonly<Record<string, unknown>>;
    };

export class LoadDiagnostics {
  readonly #entries: LoadDiagnostic[] = [];

  record(diagnostic: LoadDiagnostic): void {
    this.#entries.push(diagnostic);
  }

  list(): ReadonlyArray<LoadDiagnostic> {
    return this.#entries;
  }

  isEmpty(): boolean {
    return this.#entries.length === 0;
  }
}

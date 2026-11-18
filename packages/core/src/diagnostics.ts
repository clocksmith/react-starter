import { failureKinds, type FailureKind } from './failure.js';

export const diagnosticOperations = ['sessionTransition', 'read', 'refresh', 'submit'] as const;
export type DiagnosticOperation = (typeof diagnosticOperations)[number];

export const diagnosticOutcomes = ['succeeded', 'failed', 'cancelled'] as const;
export type DiagnosticOutcome = (typeof diagnosticOutcomes)[number];

/** Intentionally accepts no free text, identifiers, URLs or payloads. */
export type DiagnosticEvent = {
  readonly operation: DiagnosticOperation;
  readonly outcome: DiagnosticOutcome;
  readonly failure?: FailureKind;
  readonly elapsedMs?: number;
};

export type DiagnosticRecord = Readonly<Record<string, string | number>>;
export type DiagnosticSink = (event: DiagnosticRecord) => void;

/**
 * Copies only the allowed fields, and only when they hold an allowed value. A caller that
 * smuggles extra properties or free text past the type system still cannot get them out.
 */
export function serializeDiagnostic(event: DiagnosticEvent): DiagnosticRecord {
  const record: Record<string, string | number> = {
    operation: diagnosticOperations.includes(event.operation) ? event.operation : 'read',
    outcome: diagnosticOutcomes.includes(event.outcome) ? event.outcome : 'failed',
  };
  if (event.failure !== undefined && failureKinds.includes(event.failure)) {
    record.failure = event.failure;
  }
  if (typeof event.elapsedMs === 'number' && Number.isFinite(event.elapsedMs)) {
    record.elapsedMs = Math.round(event.elapsedMs);
  }
  return Object.freeze(record);
}

/** A failing diagnostic sink cannot interrupt a user operation. */
export class Diagnostics {
  readonly #sink: DiagnosticSink | undefined;

  constructor(options: { sink?: DiagnosticSink } = {}) {
    this.#sink = options.sink;
  }

  record(event: DiagnosticEvent): void {
    try {
      this.#sink?.(serializeDiagnostic(event));
    } catch {
      // Logging its own failure could recurse or expose the sink's payload.
    }
  }
}

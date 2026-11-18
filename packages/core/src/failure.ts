export const failureKinds = [
  'unavailable',
  'validation',
  'conflict',
  'forbidden',
  'unauthenticated',
  'sessionExpired',
  'unexpected',
] as const;

export type FailureKind = (typeof failureKinds)[number];

/**
 * A safe category for presentation. `cause` is kept for debugging in memory only:
 * it is not enumerable and never appears in the message, `toString` or JSON.
 */
export class AppFailure extends Error {
  readonly kind: FailureKind;
  declare readonly cause: unknown;

  constructor(kind: FailureKind, options: { cause?: unknown } = {}) {
    super(`AppFailure(${kind})`);
    this.name = 'AppFailure';
    this.kind = kind;
    Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false });
  }

  override toString(): string {
    return `AppFailure(${this.kind})`;
  }

  toJSON(): { kind: FailureKind } {
    return { kind: this.kind };
  }
}

/** The failure kind of any thrown value; unknown errors are `unexpected`. */
export function failureKindOf(error: unknown): FailureKind {
  return error instanceof AppFailure ? error.kind : 'unexpected';
}

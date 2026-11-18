import { Diagnostics } from './diagnostics.js';
import { AppFailure } from './failure.js';

export type SessionIdentity = {
  readonly accountId: string;
  readonly tenantId?: string;
};

export function sameIdentity(a: SessionIdentity, b: SessionIdentity): boolean {
  return a.accountId === b.accountId && a.tenantId === b.tenantId;
}

let nextOwner = 0;

/**
 * Identifies one activation. Two keys are the same session only if they are the same object:
 * signing in to the same account again yields a new key. `id` is a string form for places that
 * need a primitive, such as a React `key`; it is unique within the page and carries no account data.
 */
export class SessionKey {
  readonly identity: SessionIdentity;
  readonly generation: number;
  readonly id: string;

  /** @internal Created only by SessionCoordinator. */
  constructor(identity: SessionIdentity, generation: number, owner: number) {
    this.identity = Object.freeze({ ...identity });
    this.generation = generation;
    this.id = `session-${owner}-${generation}`;
    Object.freeze(this);
  }
}

export type SessionCleanup = () => void | Promise<void>;

/** Internal controls for a handle, held only by the coordinator that created it. */
type HandleControls = { revoke(): void; close(): Promise<void> };
const controls = new WeakMap<SessionHandle, HandleControls>();

/** A revocable capability. Check after each await before publishing or mutating. */
export class SessionHandle {
  readonly key: SessionKey;
  #cleanups: SessionCleanup[] = [];
  #active = true;
  #closing: Promise<void> | null = null;

  /** @internal Created only by SessionCoordinator. */
  constructor(key: SessionKey) {
    this.key = key;
    controls.set(this, {
      revoke: () => {
        this.#active = false;
      },
      close: () => {
        this.#active = false;
        return (this.#closing ??= this.#drain());
      },
    });
  }

  get isActive(): boolean {
    return this.#active;
  }

  requireActive(): void {
    if (!this.#active) throw new AppFailure('sessionExpired');
  }

  registerCleanup(cleanup: SessionCleanup): void {
    this.requireActive();
    this.#cleanups.push(cleanup);
  }

  async #drain(): Promise<void> {
    let firstError: unknown;
    let failed = false;
    const pending = [...this.#cleanups].reverse();
    this.#cleanups = [];
    for (const cleanup of pending) {
      try {
        await cleanup();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
        // Kept so that a retried transition runs it again.
        this.#cleanups.push(cleanup);
      }
    }
    this.#closing = null;
    if (failed) throw new AppFailure('unexpected', { cause: firstError });
  }
}

export type SessionStatus = 'signedOut' | 'transitioning' | 'ready' | 'failed' | 'closed';

export type SessionState = {
  readonly status: SessionStatus;
  readonly session?: SessionHandle;
  readonly failure?: AppFailure;
};

export type SessionListener = (state: SessionState) => void;

const signedOut: SessionState = Object.freeze({ status: 'signedOut' });
const transitioning: SessionState = Object.freeze({ status: 'transitioning' });
const closed: SessionState = Object.freeze({ status: 'closed' });

/**
 * Owns the account boundary, not a backend's authentication protocol.
 *
 * Transitions revoke synchronously, serialize cleanup, and publish only the latest request.
 * Register resources (including credential cleanup) on the handle. App adapters must guard late
 * authentication and storage effects.
 */
export class SessionCoordinator {
  readonly diagnostics: Diagnostics;
  readonly #owner = ++nextOwner;
  readonly #listeners = new Set<SessionListener>();
  readonly #doneCallbacks = new Set<() => void>();
  #state: SessionState = signedOut;
  #current: SessionHandle | null = null;
  #tail: Promise<void> = Promise.resolve();
  #disposing: Promise<void> | null = null;
  #generation = 0;
  #disposed = false;

  constructor(options: { diagnostics?: Diagnostics } = {}) {
    this.diagnostics = options.diagnostics ?? new Diagnostics();
  }

  /** The current state. The same object is returned until the next transition. */
  get state(): SessionState {
    return this.#state;
  }

  /** Delivers subsequent transitions. Arrow property so it can be passed as a callback. */
  readonly subscribe = (listener: SessionListener): (() => void) => {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Replays the current state, then delivers subsequent transitions. `onDone` runs on dispose. */
  watch(listener: SessionListener, onDone?: () => void): () => void {
    listener(this.#state);
    const unsubscribe = this.subscribe(listener);
    if (onDone) {
      if (this.#disposed) onDone();
      else this.#doneCallbacks.add(onDone);
    }
    return () => {
      unsubscribe();
      if (onDone) this.#doneCallbacks.delete(onDone);
    };
  }

  activate(
    identity: SessionIdentity,
    options: { prepare?: (session: SessionHandle) => Promise<void> } = {},
  ): Promise<void> {
    return this.#transition(identity, options.prepare);
  }

  signOut(): Promise<void> {
    return this.#transition(null, undefined);
  }

  #transition(
    identity: SessionIdentity | null,
    prepare: ((session: SessionHandle) => Promise<void>) | undefined,
  ): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('SessionCoordinator is closed'));
    const generation = ++this.#generation;
    if (this.#current) controls.get(this.#current)?.revoke();
    this.#publish(transitioning);
    const operation = this.#tail.then(async () => {
      try {
        if (this.#current) await controls.get(this.#current)?.close();
        this.#current = null;
        if (this.#disposed || generation !== this.#generation) return;
        if (identity === null) {
          this.#publish(signedOut);
          return;
        }
        const handle = new SessionHandle(new SessionKey(identity, generation, this.#owner));
        this.#current = handle;
        await prepare?.(handle);
        if (this.#disposed || generation !== this.#generation) return;
        handle.requireActive();
        this.#publish(Object.freeze({ status: 'ready', session: handle }));
        this.diagnostics.record({ operation: 'sessionTransition', outcome: 'succeeded' });
      } catch (error) {
        if (this.#current) controls.get(this.#current)?.revoke();
        const failure =
          error instanceof AppFailure ? error : new AppFailure('unexpected', { cause: error });
        if (!this.#disposed && generation === this.#generation) {
          this.#publish(Object.freeze({ status: 'failed', failure }));
          this.diagnostics.record({
            operation: 'sessionTransition',
            outcome: 'failed',
            failure: failure.kind,
          });
        }
        throw failure;
      }
    });
    this.#tail = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  #publish(state: SessionState): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener(state);
  }

  /** Revokes immediately; callers await cleanup before tearing down storage. */
  dispose(): Promise<void> {
    if (this.#disposing) return this.#disposing;
    this.#disposed = true;
    ++this.#generation;
    if (this.#current) controls.get(this.#current)?.revoke();
    this.#publish(closed);
    return (this.#disposing = this.#finishDisposal());
  }

  async #finishDisposal(): Promise<void> {
    await this.#tail;
    try {
      if (this.#current) await controls.get(this.#current)?.close();
      this.#current = null;
    } finally {
      this.#listeners.clear();
      const done = [...this.#doneCallbacks];
      this.#doneCallbacks.clear();
      for (const callback of done) callback();
    }
  }
}

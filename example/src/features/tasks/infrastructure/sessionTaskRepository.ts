import {
  AppFailure,
  Diagnostics,
  failureKindOf,
  type FailureKind,
  type SessionHandle,
} from '@react-starter/core';
import {
  completeTask,
  type Task,
  type TaskListResource,
  type TaskRepository,
  type TaskResource,
} from '../domain/task';
import type { TaskApi } from './taskApi';

type Completion = { readonly operationId: string; readonly note: string; readonly etag: string };

/**
 * The example's feature policy for one session: caching, optimistic completion, idempotent retry
 * and conflict handling. It intentionally lives outside core and ui.
 *
 * Every public method is an arrow property so it can be handed to React as a callback.
 */
export class SessionTaskRepository implements TaskRepository {
  readonly #session: SessionHandle;
  readonly #api: TaskApi;
  readonly #newOperationId: () => string;
  readonly #diagnostics: Diagnostics;
  readonly #listeners = new Set<() => void>();
  readonly #confirmed = new Map<string, Task>();
  readonly #operations = new Map<string, Completion>();
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #failures = new Map<string, FailureKind>();
  readonly #readGenerations = new Map<string, number>();
  readonly #loading = new Set<string>();
  #ids: string[] = [];
  #listLoaded = false;
  #listLoading = false;
  #listFailure: FailureKind | undefined;
  #listGeneration = 0;
  #mutationGeneration = 0;
  #closed = false;
  // Snapshots are rebuilt only after a change, so readers get a stable object between changes.
  #version = 0;
  #listCache: { version: number; value: TaskListResource } | null = null;
  readonly #taskCache = new Map<string, { version: number; value: TaskResource }>();

  constructor(options: {
    session: SessionHandle;
    api: TaskApi;
    newOperationId: () => string;
    diagnostics?: Diagnostics;
  }) {
    this.#session = options.session;
    this.#api = options.api;
    this.#newOperationId = options.newOperationId;
    this.#diagnostics = options.diagnostics ?? new Diagnostics();
    // The session closes this repository even if composition forgets to.
    this.#session.registerCleanup(this.close);
  }

  get subscriberCount(): number {
    return this.#listeners.size;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  get #active(): boolean {
    return !this.#closed && this.#session.isActive;
  }

  #requireActive(): void {
    this.#session.requireActive();
    if (this.#closed) throw new AppFailure('sessionExpired');
  }

  #emit(): void {
    if (!this.#active) return;
    this.#version++;
    for (const listener of [...this.#listeners]) listener();
  }

  #watch(onChange: () => void, ensureLoaded: () => void): () => void {
    // A closed or revoked repository delivers nothing and counts no subscriber.
    if (!this.#active) return () => {};
    this.#listeners.add(onChange);
    ensureLoaded();
    return () => {
      this.#listeners.delete(onChange);
    };
  }

  readonly watchList = (onChange: () => void): (() => void) =>
    this.#watch(onChange, () => {
      if (!this.#listLoaded && !this.#listLoading) void this.refreshList().catch(() => {});
    });

  readonly watch = (id: string, onChange: () => void): (() => void) =>
    this.#watch(onChange, () => {
      if (!this.#confirmed.has(id) && !this.#loading.has(id)) void this.refresh(id).catch(() => {});
    });

  readonly listSnapshot = (): TaskListResource => {
    if (this.#listCache?.version !== this.#version) {
      const value: TaskListResource = {
        sessionKey: this.#session.key,
        tasks: this.#ids.map((id) => this.snapshot(id)),
        loading: this.#listLoading,
        ...(this.#listFailure ? { failure: this.#listFailure } : {}),
      };
      this.#listCache = { version: this.#version, value };
    }
    return this.#listCache.value;
  };

  readonly snapshot = (id: string): TaskResource => {
    const cached = this.#taskCache.get(id);
    if (cached?.version === this.#version) return cached.value;
    const confirmed = this.#confirmed.get(id);
    const pending = this.#inFlight.has(id);
    const operation = this.#operations.get(id);
    const failure = this.#failures.get(id);
    // While a completion is in flight, show its result optimistically.
    const task =
      pending && operation && confirmed ? completeTask(confirmed, operation.note) : confirmed;
    const value: TaskResource = {
      sessionKey: this.#session.key,
      ...(task ? { task } : {}),
      loading: this.#loading.has(id),
      pending,
      needsRetry: operation !== undefined && !pending,
      ...(failure ? { failure } : {}),
    };
    this.#taskCache.set(id, { version: this.#version, value });
    return value;
  };

  /** A server response never replaces a newer revision already held. */
  #merge(task: Task): void {
    const current = this.#confirmed.get(task.id);
    if (!current || task.revision > current.revision) this.#confirmed.set(task.id, task);
  }

  readonly refreshList = async (): Promise<void> => {
    this.#requireActive();
    const generation = ++this.#listGeneration;
    const mutation = this.#mutationGeneration;
    this.#listLoading = true;
    this.#listFailure = undefined;
    this.#emit();
    try {
      const tasks = await this.#api.list();
      // After every await: the account may have changed, or a newer refresh may have started.
      if (!this.#active || generation !== this.#listGeneration) return;
      for (const task of tasks) this.#merge(task);
      // A list fetched before a write must not decide membership after it.
      if (mutation === this.#mutationGeneration) {
        this.#ids = [...new Set(tasks.map((task) => task.id))];
        this.#listLoaded = true;
      }
    } catch (error) {
      if (this.#active && generation === this.#listGeneration)
        this.#listFailure = failureKindOf(error);
    } finally {
      if (this.#active && generation === this.#listGeneration) {
        this.#listLoading = false;
        this.#emit();
      }
    }
  };

  readonly refresh = async (id: string): Promise<void> => {
    this.#requireActive();
    const generation = (this.#readGenerations.get(id) ?? 0) + 1;
    this.#readGenerations.set(id, generation);
    this.#loading.add(id);
    this.#failures.delete(id);
    this.#emit();
    const current = () => this.#active && generation === this.#readGenerations.get(id);
    try {
      const task = await this.#api.read(id);
      if (!current()) return;
      this.#merge(task);
    } catch (error) {
      if (current()) this.#failures.set(id, failureKindOf(error));
    } finally {
      if (current()) {
        this.#loading.delete(id);
        this.#emit();
      }
    }
  };

  readonly complete = (id: string, note: string): Promise<void> => {
    try {
      this.#requireActive();
    } catch (error) {
      return Promise.reject(error);
    }
    // A second tap while the first is in flight shares its outcome and sends nothing.
    const existing = this.#inFlight.get(id);
    if (existing) return existing;
    // An earlier attempt has an unknown outcome; only that same operation may be retried.
    if (this.#operations.has(id)) return Promise.reject(new AppFailure('conflict'));
    const task = this.#confirmed.get(id);
    if (!task || task.completed || note.trim() === '') {
      return Promise.reject(new AppFailure('validation'));
    }
    this.#operations.set(id, {
      operationId: this.#newOperationId(),
      note,
      etag: task.versionToken,
    });
    return this.#send(id);
  };

  readonly retryCompletion = (id: string): Promise<void> => {
    try {
      this.#requireActive();
    } catch (error) {
      return Promise.reject(error);
    }
    const existing = this.#inFlight.get(id);
    if (existing) return existing;
    if (!this.#operations.has(id)) return Promise.reject(new AppFailure('validation'));
    return this.#send(id);
  };

  #send(id: string): Promise<void> {
    const operation = this.#operations.get(id)!;
    let resolve!: () => void;
    let reject!: (failure: AppFailure) => void;
    const outcome = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Recorded before the request starts, so the request can never finish first and leave a
    // stale in-flight entry behind.
    this.#inFlight.set(id, outcome);
    ++this.#mutationGeneration;
    this.#failures.delete(id);
    this.#emit();
    void this.#settle(id, operation, resolve, reject);
    return outcome;
  }

  /** Never rejects: the outcome is delivered through `resolve` and `reject`. */
  async #settle(
    id: string,
    operation: Completion,
    resolve: () => void,
    reject: (failure: AppFailure) => void,
  ): Promise<void> {
    try {
      const task = await this.#api.complete(id, {
        note: operation.note,
        etag: operation.etag,
        operationId: operation.operationId,
      });
      this.#requireActive();
      this.#merge(task);
      this.#operations.delete(id);
      this.#diagnostics.record({ operation: 'submit', outcome: 'succeeded' });
      resolve();
    } catch (error) {
      const kind: FailureKind = this.#active ? failureKindOf(error) : 'sessionExpired';
      if (this.#active) {
        this.#failures.set(id, kind);
        // Only an uncertain outcome keeps the operation for an identical retry.
        if (kind !== 'unavailable' && kind !== 'unexpected') this.#operations.delete(id);
        this.#diagnostics.record({ operation: 'submit', outcome: 'failed', failure: kind });
      }
      reject(new AppFailure(kind));
    } finally {
      this.#inFlight.delete(id);
      ++this.#mutationGeneration;
      this.#emit();
    }
  }

  /** Idempotent. Drops all account data and stops delivering changes. */
  readonly close = (): void => {
    if (this.#closed) return;
    this.#closed = true;
    this.#listeners.clear();
    this.#confirmed.clear();
    this.#operations.clear();
    this.#failures.clear();
    this.#loading.clear();
    this.#ids = [];
    this.#listLoading = false;
    this.#listFailure = undefined;
    // One last version bump so no reader can be handed a cached snapshot of the old account.
    this.#version++;
    this.#listCache = null;
    this.#taskCache.clear();
  };
}

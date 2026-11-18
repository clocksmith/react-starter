import { AppFailure, type SessionIdentity } from '@react-starter/core';
import { completeTask, type Task } from '../domain/task';
import type { TaskApi } from './taskApi';

export type CompletionBehavior = 'succeed' | 'reject' | 'loseResponse';

type StoredResult = { id: string; note: string; etag: string; task: Task };

const accountKey = (identity: SessionIdentity) =>
  JSON.stringify([identity.accountId, identity.tenantId ?? null]);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Synthetic server state survives account replacement, like a remote service. */
export class MemoryTaskServer {
  readonly latencyMs: number;
  completionRequests = 0;
  readonly #accounts = new Map<string, Map<string, Task>>();
  readonly #results = new Map<string, StoredResult>();
  readonly #nextCompletion = new Map<string, CompletionBehavior>();

  constructor(options: { latencyMs?: number } = {}) {
    this.latencyMs = options.latencyMs ?? 300;
  }

  /** Arms one failure for the next completion by this account only. */
  simulateNextCompletion(identity: SessionIdentity, behavior: CompletionBehavior): void {
    this.#nextCompletion.set(accountKey(identity), behavior);
  }

  /** Arrow property so it can be passed around as a factory. */
  readonly forAccount = (identity: SessionIdentity): TaskApi => {
    const account = accountKey(identity);
    const tasks = () => this.#tasks(identity);
    return {
      list: async () => {
        const snapshot = [...tasks().values()];
        await delay(this.latencyMs);
        return snapshot;
      },
      read: async (id) => {
        const task = tasks().get(id);
        await delay(this.latencyMs);
        if (!task) throw new AppFailure('validation');
        return task;
      },
      complete: async (id, { note, etag, operationId }) => {
        this.completionRequests++;
        const behavior = this.#nextCompletion.get(account) ?? 'succeed';
        this.#nextCompletion.delete(account);
        await delay(this.latencyMs);
        // Idempotency: the same operation id returns the first result, for this account only.
        const resultKey = JSON.stringify([account, operationId]);
        const previous = this.#results.get(resultKey);
        if (previous) {
          if (previous.id !== id || previous.note !== note || previous.etag !== etag) {
            throw new AppFailure('validation');
          }
          return previous.task;
        }
        if (behavior === 'reject') throw new AppFailure('validation');
        const task = tasks().get(id);
        if (!task) throw new AppFailure('validation');
        if (task.versionToken !== etag) throw new AppFailure('conflict');
        if (task.completed || note.trim() === '') throw new AppFailure('validation');
        const result = completeTask(task, note, {
          revision: task.revision + 1,
          versionToken: `"task-${id}-${task.revision + 1}"`,
        });
        tasks().set(id, result);
        this.#results.set(resultKey, { id, note, etag, task: result });
        // The write happened; only the reply is lost.
        if (behavior === 'loseResponse') throw new AppFailure('unavailable');
        return result;
      },
    };
  };

  #tasks(identity: SessionIdentity): Map<string, Task> {
    const key = accountKey(identity);
    let tasks = this.#accounts.get(key);
    if (!tasks) {
      const seed = (id: string, title: string, revision: number): Task => ({
        id,
        title: `${identity.accountId}: ${title}`,
        revision,
        versionToken: `"task-${id}-${revision}"`,
        completed: false,
        note: '',
      });
      tasks = new Map([
        ['1', seed('1', 'Plan the first release', 7)],
        ['2', seed('2', 'Review the checklist', 1)],
      ]);
      this.#accounts.set(key, tasks);
    }
    return tasks;
  }
}

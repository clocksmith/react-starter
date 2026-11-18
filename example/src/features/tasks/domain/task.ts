import type { FailureKind, SessionKey } from '@react-starter/core';

export type Task = {
  readonly id: string;
  readonly title: string;
  readonly revision: number;
  /** Opaque precondition token from the server; sent back unchanged on a write. */
  readonly versionToken: string;
  readonly completed: boolean;
  readonly note: string;
};

export function completeTask(
  task: Task,
  note: string,
  server: { revision?: number; versionToken?: string } = {},
): Task {
  return {
    ...task,
    revision: server.revision ?? task.revision,
    versionToken: server.versionToken ?? task.versionToken,
    completed: true,
    note,
  };
}

export type TaskResource = {
  /** The session this state belongs to. Presentation shows it only for the matching session. */
  readonly sessionKey: SessionKey;
  readonly task?: Task;
  readonly loading: boolean;
  /** A completion is in flight; `task` shows the optimistic result. */
  readonly pending: boolean;
  /** A completion's outcome is unknown; retrying sends the same operation again. */
  readonly needsRetry: boolean;
  readonly failure?: FailureKind;
};

export type TaskListResource = {
  readonly sessionKey: SessionKey;
  readonly tasks: readonly TaskResource[];
  readonly loading: boolean;
  readonly failure?: FailureKind;
};

/**
 * What presentation may ask of task storage. A watcher is told when state may have changed and
 * then reads a snapshot; a snapshot is the same object until the state it describes changes.
 */
export interface TaskRepository {
  /** Starts loading the list if needed. Returns a function that stops watching. */
  watchList(onChange: () => void): () => void;
  listSnapshot(): TaskListResource;
  /** Starts loading the task if needed. Returns a function that stops watching. */
  watch(id: string, onChange: () => void): () => void;
  snapshot(id: string): TaskResource;
  refreshList(): Promise<void>;
  refresh(id: string): Promise<void>;
  /** Rejects with an AppFailure when the completion is not accepted. */
  complete(id: string, note: string): Promise<void>;
  /** Sends the same operation again after an uncertain outcome. */
  retryCompletion(id: string): Promise<void>;
}

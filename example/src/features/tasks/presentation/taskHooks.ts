import type { SessionHandle } from '@react-starter/core';
import { useCallback, useContext, useSyncExternalStore } from 'react';
import type { TaskListResource, TaskRepository, TaskResource } from '../domain/task';
import { TaskRepositoryContext } from './taskContext';

const noWatch = () => () => {};

export function useTaskRepository(): TaskRepository | null {
  return useContext(TaskRepositoryContext);
}

/**
 * The task list for `session`, or null until that session's repository has state. State that
 * belongs to any other session is never returned, so one account cannot briefly show another's.
 */
export function useTaskList(session: SessionHandle): TaskListResource | null {
  const repository = useTaskRepository();
  const value = useSyncExternalStore(repository ? repository.watchList : noWatch, () =>
    repository ? repository.listSnapshot() : null,
  );
  return value?.sessionKey === session.key ? value : null;
}

/** One task for `session`, with the same session guard as the list. */
export function useTask(session: SessionHandle, id: string): TaskResource | null {
  const repository = useTaskRepository();
  const watch = useCallback(
    (onChange: () => void) => (repository ? repository.watch(id, onChange) : () => {}),
    [repository, id],
  );
  const value = useSyncExternalStore(watch, () => (repository ? repository.snapshot(id) : null));
  return value?.sessionKey === session.key ? value : null;
}

import { createContext } from 'react';
import type { TaskRepository } from '../domain/task';

/**
 * The repository for the current session, or null while there is none. Composition supplies the
 * concrete implementation; presentation only ever sees the domain contract.
 */
export const TaskRepositoryContext = createContext<TaskRepository | null>(null);

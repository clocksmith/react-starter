import type { Task } from '../domain/task';

/** Account binding is supplied when the adapter is created. */
export interface TaskApi {
  list(): Promise<Task[]>;
  read(id: string): Promise<Task>;
  complete(id: string, request: { note: string; etag: string; operationId: string }): Promise<Task>;
}

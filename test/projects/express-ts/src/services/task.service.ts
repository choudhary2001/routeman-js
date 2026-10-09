import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/httpError.js';
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from '../schemas/task.schema.js';
import type { AuthUser } from '../types/express.js';
import type { Database, Task } from './db.js';
import type { ProjectService } from './project.service.js';

export class TaskService {
  constructor(
    private readonly db: Database,
    private readonly projects: ProjectService,
  ) {}

  private assertAssignee(assigneeId: string | undefined) {
    if (assigneeId && !this.db.users.has(assigneeId)) {
      throw HttpError.unprocessable(`Assignee ${assigneeId} does not exist`);
    }
  }

  list(projectId: string, user: AuthUser, query: ListTasksQuery) {
    this.projects.getForUser(projectId, user);
    const all = [...this.db.tasks.values()].filter(
      (task) =>
        task.projectId === projectId &&
        (!query.status || task.status === query.status) &&
        (!query.priority || task.priority === query.priority),
    );
    const start = (query.page - 1) * query.pageSize;
    return {
      items: all.slice(start, start + query.pageSize),
      total: all.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  get(projectId: string, taskId: string, user: AuthUser): Task {
    this.projects.getForUser(projectId, user);
    const task = this.db.tasks.get(taskId);
    if (!task || task.projectId !== projectId) throw HttpError.notFound('Task');
    return task;
  }

  create(projectId: string, user: AuthUser, input: CreateTaskInput): Task {
    this.projects.getForUser(projectId, user);
    this.assertAssignee(input.assigneeId);

    const now = new Date();
    const task: Task = {
      id: randomUUID(),
      projectId,
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      assigneeId: input.assigneeId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.tasks.set(task.id, task);
    return task;
  }

  update(projectId: string, taskId: string, user: AuthUser, input: UpdateTaskInput): Task {
    const task = this.get(projectId, taskId, user);
    this.assertAssignee(input.assigneeId);

    if (input.title !== undefined) task.title = input.title;
    if (input.description !== undefined) task.description = input.description;
    if (input.status !== undefined) task.status = input.status;
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.dueDate !== undefined) task.dueDate = new Date(input.dueDate);
    if (input.assigneeId !== undefined) task.assigneeId = input.assigneeId;
    task.updatedAt = new Date();
    return task;
  }

  remove(projectId: string, taskId: string, user: AuthUser): void {
    const task = this.get(projectId, taskId, user);
    this.db.tasks.delete(task.id);
  }
}

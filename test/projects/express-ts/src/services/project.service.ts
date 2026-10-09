import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/httpError.js';
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from '../schemas/project.schema.js';
import type { AuthUser } from '../types/express.js';
import type { Database, Project } from './db.js';

export class ProjectService {
  constructor(private readonly db: Database) {}

  list(user: AuthUser, filters: ListProjectsQuery): Project[] {
    return [...this.db.projects.values()].filter((project) => {
      if (user.role !== 'admin' && project.ownerId !== user.id) return false;
      if (filters.archived !== undefined && project.archived !== filters.archived) return false;
      if (filters.search && !project.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    });
  }

  /** Throws 404 for missing projects and for projects the user cannot see. */
  getForUser(id: string, user: AuthUser): Project {
    const project = this.db.projects.get(id);
    if (!project || (user.role !== 'admin' && project.ownerId !== user.id)) {
      throw HttpError.notFound('Project');
    }
    return project;
  }

  create(user: AuthUser, input: CreateProjectInput): Project {
    const duplicate = [...this.db.projects.values()].some(
      (p) => p.ownerId === user.id && p.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (duplicate) throw HttpError.conflict(`Project "${input.name}" already exists`);

    const now = new Date();
    const project: Project = {
      id: randomUUID(),
      ownerId: user.id,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    this.db.projects.set(project.id, project);
    return project;
  }

  update(id: string, user: AuthUser, input: UpdateProjectInput): Project {
    const project = this.getForUser(id, user);
    if (input.name !== undefined) project.name = input.name;
    if (input.description !== undefined) project.description = input.description;
    if (input.color !== undefined) project.color = input.color;
    if (input.archived !== undefined) project.archived = input.archived;
    project.updatedAt = new Date();
    return project;
  }

  remove(id: string, user: AuthUser): void {
    const project = this.getForUser(id, user);
    this.db.projects.delete(project.id);
    for (const [taskId, task] of this.db.tasks) {
      if (task.projectId === project.id) this.db.tasks.delete(taskId);
    }
  }
}

import type { Request, Response } from 'express';
import type {
  CreateTaskInput,
  ListTasksQuery,
  ProjectParams,
  TaskParams,
  UpdateTaskInput,
} from '../schemas/task.schema.js';
import type { TaskService } from '../services/task.service.js';

export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  list = async (req: Request<ProjectParams, unknown, unknown, ListTasksQuery>, res: Response) => {
    const page = this.tasks.list(req.params.projectId, req.user!, req.query);
    res.json(page);
  };

  getById = async (req: Request<TaskParams>, res: Response) => {
    const task = this.tasks.get(req.params.projectId, req.params.id, req.user!);
    res.json(task);
  };

  create = async (req: Request<ProjectParams, unknown, CreateTaskInput>, res: Response) => {
    const task = this.tasks.create(req.params.projectId, req.user!, req.body);
    res.status(201).location(`${req.baseUrl}/${task.id}`).json(task);
  };

  update = async (req: Request<TaskParams, unknown, UpdateTaskInput>, res: Response) => {
    const task = this.tasks.update(req.params.projectId, req.params.id, req.user!, req.body);
    res.json(task);
  };

  remove = async (req: Request<TaskParams>, res: Response) => {
    this.tasks.remove(req.params.projectId, req.params.id, req.user!);
    res.status(204).end();
  };
}

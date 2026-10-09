import { Router } from 'express';
import { TaskController } from '../controllers/task.controller.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import {
  createTaskSchema,
  listTasksQuerySchema,
  projectParamsSchema,
  taskParamsSchema,
  updateTaskSchema,
} from '../schemas/task.schema.js';
import { taskService } from '../services/index.js';

const taskController = new TaskController(taskService);

// mounted at /projects/:projectId/tasks, so we need the parent's params
export const taskRouter = Router({ mergeParams: true });

taskRouter.use(requireAuth);

taskRouter
  .route('/')
  .get(validate({ params: projectParamsSchema, query: listTasksQuerySchema }), asyncHandler(taskController.list))
  .post(validate({ params: projectParamsSchema, body: createTaskSchema }), asyncHandler(taskController.create));

taskRouter
  .route('/:id')
  .get(validate({ params: taskParamsSchema }), asyncHandler(taskController.getById))
  .patch(validate({ params: taskParamsSchema, body: updateTaskSchema }), asyncHandler(taskController.update))
  .delete(validate({ params: taskParamsSchema }), asyncHandler(taskController.remove));

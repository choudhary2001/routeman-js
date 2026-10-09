import { Router } from 'express';
import { projectService } from '../services/index.js';
import { adminRouter } from './admin.routes.js';
import { authRouter } from './auth.routes.js';
import { createProjectRouter } from './project.routes.js';
import { taskRouter } from './task.routes.js';

interface RouteDefinition {
  path: string;
  router: Router;
}

const routes: RouteDefinition[] = [
  { path: '/auth', router: authRouter },
  { path: '/projects', router: createProjectRouter(projectService) },
  { path: '/projects/:projectId/tasks', router: taskRouter },
  { path: '/admin', router: adminRouter },
];

export const apiRouter = Router();

for (const { path, router } of routes) {
  apiRouter.use(path, router);
}

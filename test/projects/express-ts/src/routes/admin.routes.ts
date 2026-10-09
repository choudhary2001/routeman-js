import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { apiKeyAuth } from '../middleware/apiKey.js';
import { validate } from '../middleware/validate.js';
import { db, toPublicUser, type Task } from '../services/db.js';

export const adminRouter = Router();

// Internal tooling authenticates with a static API key instead of user JWTs
adminRouter.use(apiKeyAuth);

adminRouter.get('/stats', (_req: Request, res: Response) => {
  const tasks = [...db.tasks.values()];
  const byStatus = tasks.reduce<Record<Task['status'], number>>(
    (acc, task) => {
      acc[task.status] += 1;
      return acc;
    },
    { todo: 0, in_progress: 0, done: 0 },
  );

  res.json({
    users: db.users.size,
    projects: db.projects.size,
    archivedProjects: [...db.projects.values()].filter((p) => p.archived).length,
    tasks: { total: tasks.length, byStatus },
    generatedAt: new Date().toISOString(),
  });
});

const listUsersQuery = z.object({
  role: z.enum(['admin', 'member']).optional(),
});

adminRouter.get('/users', validate({ query: listUsersQuery }), (req: Request, res: Response) => {
  const { role } = req.query as z.infer<typeof listUsersQuery>;
  const users = [...db.users.values()].filter((u) => !role || u.role === role).map(toPublicUser);
  res.json({ data: users, total: users.length });
});

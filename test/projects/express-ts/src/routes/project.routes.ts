import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type ListProjectsQuery,
  type UpdateProjectInput,
} from '../schemas/project.schema.js';
import type { ProjectService } from '../services/project.service.js';

type IdParams = { id: string };

export function createProjectRouter(service: ProjectService) {
  const router = Router();

  router.use(requireAuth);

  router.get(
    '/',
    validate({ query: listProjectsQuerySchema }),
    asyncHandler(async (req: Request<unknown, unknown, unknown, ListProjectsQuery>, res: Response) => {
      const projects = service.list(req.user!, req.query);
      res.json({ data: projects, total: projects.length });
    }),
  );

  router.post(
    '/',
    validate({ body: createProjectSchema }),
    asyncHandler(async (req: Request<unknown, unknown, CreateProjectInput>, res: Response) => {
      const project = service.create(req.user!, req.body);
      res.status(201).json(project);
    }),
  );

  router.get(
    '/:id',
    validate({ params: projectIdParamsSchema }),
    asyncHandler(async (req: Request<IdParams>, res: Response) => {
      res.json(service.getForUser(req.params.id, req.user!));
    }),
  );

  router.put(
    '/:id',
    validate({ params: projectIdParamsSchema, body: updateProjectSchema }),
    asyncHandler(async (req: Request<IdParams, unknown, UpdateProjectInput>, res: Response) => {
      res.json(service.update(req.params.id, req.user!, req.body));
    }),
  );

  router.delete(
    '/:id',
    validate({ params: projectIdParamsSchema }),
    asyncHandler(async (req: Request<IdParams>, res: Response) => {
      service.remove(req.params.id, req.user!);
      res.status(204).end();
    }),
  );

  return router;
}

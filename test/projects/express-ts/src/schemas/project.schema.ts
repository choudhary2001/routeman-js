import { z } from 'zod';

export const projectIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex color like #3366ff')
    .optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const listProjectsQuerySchema = z.object({
  search: z.string().trim().optional(),
  archived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

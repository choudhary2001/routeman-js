import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';

interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * validate({ body: createTaskSchema, params: taskParamsSchema })
 * Parses each part of the request and replaces it with the parsed (coerced/defaulted) value.
 */
export const validate =
  (schemas: RequestSchemas): RequestHandler<any, any, any, any> =>
  (req, res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: 'ValidationError',
          issues: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
        return;
      }
      next(err);
    }
  };

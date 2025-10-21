import { ZodError, type ZodTypeAny } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/httpErrors.js';

interface Schema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schema: Schema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) req.query = schema.query.parse(req.query);
      if (schema.params) req.params = schema.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        console.error('Validation error:', JSON.stringify(err.flatten(), null, 2));
        console.error('Request body:', JSON.stringify(req.body, null, 2));
        return next(new HttpError(400, 'Invalid request', err.flatten()));
      }
      next(err);
    }
  };
}

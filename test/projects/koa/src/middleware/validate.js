function toValidationError(error) {
  const err = new Error('Validation failed');
  err.status = 422;
  err.name = 'ValidationError';
  err.expose = true;
  err.details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
  return err;
}

/** Validates ctx.request.body against a Joi schema and replaces it with the sanitized value. */
function validate(schema) {
  return async (ctx, next) => {
    const { error, value } = schema.validate(ctx.request.body || {}, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) throw toValidationError(error);
    ctx.request.body = value;
    await next();
  };
}

/** Validates ctx.query; the coerced result is exposed as ctx.state.query. */
function validateQuery(schema) {
  return async (ctx, next) => {
    const { error, value } = schema.validate({ ...ctx.query }, {
      abortEarly: false,
      convert: true,
      stripUnknown: true,
    });
    if (error) throw toValidationError(error);
    ctx.state.query = value;
    await next();
  };
}

module.exports = { validate, validateQuery };

const { validationResult } = require('express-validator');

// Runs after express-validator chains and short-circuits with 422 on failure.
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }

  return res.status(422).json({
    success: false,
    errors: errors.array().map((err) => ({ field: err.path, message: err.msg })),
  });
};

module.exports = validate;

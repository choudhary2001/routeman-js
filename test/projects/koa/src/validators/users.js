const Joi = require('joi');

const roles = ['admin', 'librarian', 'member'];

const listUsers = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(25),
  role: Joi.string().valid(...roles),
});

const createUser = Joi.object({
  email: Joi.string().email().required(),
  username: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid(...roles).default('member'),
});

const updateUser = Joi.object({
  email: Joi.string().email(),
  username: Joi.string().alphanum().min(3).max(30),
  password: Joi.string().min(8),
  role: Joi.string().valid(...roles),
}).min(1);

module.exports = { listUsers, createUser, updateUser };

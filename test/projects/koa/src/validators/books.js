const Joi = require('joi');

const currentYear = new Date().getFullYear();

const bookFields = {
  title: Joi.string().trim().min(1).max(200),
  author: Joi.string().trim().min(1).max(120),
  isbn: Joi.string().pattern(/^(97[89])?\d{9}[\dX]$/),
  genre: Joi.string().max(50),
  publishedYear: Joi.number().integer().min(1450).max(currentYear),
  available: Joi.boolean(),
};

const createBook = Joi.object({
  ...bookFields,
  title: bookFields.title.required(),
  author: bookFields.author.required(),
});

const updateBook = Joi.object(bookFields).min(1);

const searchBooks = Joi.object({
  q: Joi.string().max(100),
  author: Joi.string().max(120),
  genre: Joi.string().max(50),
  available: Joi.boolean(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

module.exports = { createBook, updateBook, searchBooks };

'use strict';

const Boom = require('@hapi/boom');

// Return every Joi error to the client instead of hapi's generic "Invalid request payload input"
exports.failAction = (request, h, err) => {

    const error = Boom.badRequest(err.message);
    error.output.payload.validation = err.details
        ? err.details.map((d) => ({ path: d.path.join('.'), message: d.message }))
        : undefined;
    throw error;
};

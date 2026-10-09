'use strict';

const Boom = require('@hapi/boom');
const Bcrypt = require('bcryptjs');
const Joi = require('joi');

const { users, nextId, toPublicUser } = require('../lib/db');
const { failAction } = require('../lib/validation');

const idParams = Joi.object({
    id: Joi.number().integer().positive().required()
});

const requireAdmin = (request) => {

    if (request.auth.credentials.user.role !== 'admin') {
        throw Boom.forbidden('Admin role required');
    }
};

const findUser = (id) => {

    const user = users.find((u) => u.id === id);
    if (!user) {
        throw Boom.notFound(`User ${id} not found`);
    }

    return user;
};

exports.plugin = {
    name: 'users',
    version: '1.0.0',
    register: async (server, options) => {

        server.route([
            {
                method: 'GET',
                path: '/',
                options: {
                    description: 'List users',
                    tags: ['api', 'users'],
                    validate: {
                        query: Joi.object({
                            page: Joi.number().integer().min(1).default(1),
                            limit: Joi.number().integer().min(1).max(100).default(20),
                            role: Joi.string().valid('admin', 'user')
                        }),
                        failAction
                    }
                },
                handler: (request, h) => {

                    const { page, limit, role } = request.query;
                    const filtered = role ? users.filter((u) => u.role === role) : users;
                    const start = (page - 1) * limit;

                    return {
                        data: filtered.slice(start, start + limit).map(toPublicUser),
                        page,
                        limit,
                        total: filtered.length
                    };
                }
            },
            {
                method: 'GET',
                path: '/me',
                options: {
                    description: 'Current user profile',
                    tags: ['api', 'users']
                },
                handler: (request, h) => toPublicUser(findUser(request.auth.credentials.user.id))
            },
            {
                method: 'GET',
                path: '/{id}',
                options: {
                    description: 'Get a user by id',
                    tags: ['api', 'users'],
                    validate: { params: idParams, failAction }
                },
                handler: (request, h) => toPublicUser(findUser(request.params.id))
            },
            {
                method: 'POST',
                path: '/',
                options: {
                    description: 'Create a user',
                    notes: 'Admin only',
                    tags: ['api', 'users'],
                    validate: {
                        payload: Joi.object({
                            email: Joi.string().email().required(),
                            username: Joi.string().alphanum().min(3).max(30).required(),
                            password: Joi.string().min(8).required(),
                            role: Joi.string().valid('admin', 'user').default('user')
                        }),
                        failAction
                    }
                },
                handler: async (request, h) => {

                    requireAdmin(request);

                    const { email, username, password, role } = request.payload;
                    if (users.some((u) => u.email === email.toLowerCase() || u.username === username)) {
                        throw Boom.conflict('Email or username already in use');
                    }

                    const user = {
                        id: nextId(users),
                        email: email.toLowerCase(),
                        username,
                        passwordHash: await Bcrypt.hash(password, 8),
                        role,
                        createdAt: new Date().toISOString()
                    };
                    users.push(user);

                    return h.response(toPublicUser(user)).code(201);
                }
            },
            {
                method: ['PUT', 'PATCH'],
                path: '/{id}',
                options: {
                    description: 'Update a user',
                    notes: 'Users may update themselves; admins may update anyone and change roles',
                    tags: ['api', 'users'],
                    validate: {
                        params: idParams,
                        payload: Joi.object({
                            email: Joi.string().email(),
                            username: Joi.string().alphanum().min(3).max(30),
                            role: Joi.string().valid('admin', 'user')
                        }).min(1),
                        failAction
                    }
                },
                handler: (request, h) => {

                    const { user: actor } = request.auth.credentials;
                    const user = findUser(request.params.id);

                    if (actor.role !== 'admin' && (actor.id !== user.id || request.payload.role)) {
                        throw Boom.forbidden();
                    }

                    Object.assign(user, request.payload);
                    return toPublicUser(user);
                }
            },
            {
                method: 'DELETE',
                path: '/{id}',
                options: {
                    description: 'Delete a user',
                    notes: 'Admin only',
                    tags: ['api', 'users'],
                    validate: { params: idParams, failAction }
                },
                handler: (request, h) => {

                    requireAdmin(request);
                    const user = findUser(request.params.id);
                    users.splice(users.indexOf(user), 1);
                    return h.response().code(204);
                }
            }
        ]);
    }
};

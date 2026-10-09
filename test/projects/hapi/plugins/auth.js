'use strict';

const Boom = require('@hapi/boom');
const Bcrypt = require('bcryptjs');
const Jwt = require('@hapi/jwt');
const Joi = require('joi');

const config = require('../lib/config');
const { users, toPublicUser } = require('../lib/db');
const { failAction } = require('../lib/validation');

const issueToken = (user) => Jwt.token.generate(
    { id: user.id, email: user.email, role: user.role },
    { key: config.jwt.secret, algorithm: 'HS256' },
    { ttlSec: config.jwt.ttlSec }
);

exports.plugin = {
    name: 'auth',
    register: async (server, options) => {

        server.route([
            {
                method: 'POST',
                path: '/login',
                options: {
                    auth: false,
                    description: 'Exchange credentials for a JWT',
                    notes: 'Accepts either the email address or the username in `email`',
                    tags: ['api', 'auth'],
                    validate: {
                        payload: Joi.object({
                            email: Joi.string().required(),
                            password: Joi.string().min(1).required()
                        }),
                        failAction
                    }
                },
                handler: async (request, h) => {

                    const { email, password } = request.payload;
                    const user = users.find((u) => u.email === email.toLowerCase() || u.username === email);

                    if (!user || !(await Bcrypt.compare(password, user.passwordHash))) {
                        throw Boom.unauthorized('Invalid email or password');
                    }

                    return {
                        token: issueToken(user),
                        expiresIn: config.jwt.ttlSec,
                        user: toPublicUser(user)
                    };
                }
            }
        ]);
    }
};

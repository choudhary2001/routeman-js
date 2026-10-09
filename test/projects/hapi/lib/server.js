'use strict';

const Hapi = require('@hapi/hapi');
const Jwt = require('@hapi/jwt');
const Joi = require('joi');

const config = require('./config');
const { failAction } = require('./validation');

const createServer = async () => {

    const server = Hapi.server({
        port: config.port,
        host: config.host,
        routes: {
            cors: true,
            validate: { failAction }
        }
    });

    server.validator(Joi);

    await server.register(Jwt);

    server.auth.strategy('jwt', 'jwt', {
        keys: config.jwt.secret,
        verify: {
            aud: false,
            iss: false,
            sub: false,
            nbf: true,
            exp: true,
            maxAgeSec: config.jwt.ttlSec,
            timeSkewSec: 15
        },
        validate: (artifacts, request, h) => {

            const { id, email, role } = artifacts.decoded.payload;
            if (!id) {
                return { isValid: false };
            }

            return {
                isValid: true,
                credentials: { user: { id, email, role } }
            };
        }
    });

    server.auth.default('jwt');

    await server.register([
        { plugin: require('../plugins/health') },
        { plugin: require('../plugins/auth'), routes: { prefix: '/api/auth' } },
        { plugin: require('../plugins/users'), routes: { prefix: '/api/users' } },
        { plugin: require('../plugins/notes'), routes: { prefix: '/api/notes' } }
    ]);

    return server;
};

exports.init = async () => {

    const server = await createServer();
    await server.start();
    return server;
};

exports.createServer = createServer;

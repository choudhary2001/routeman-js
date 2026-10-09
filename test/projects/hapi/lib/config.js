'use strict';

module.exports = {
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    jwt: {
        secret: process.env.JWT_SECRET || 'test-secret',
        ttlSec: 4 * 60 * 60
    }
};

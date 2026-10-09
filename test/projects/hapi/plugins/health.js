'use strict';

exports.plugin = {
    name: 'health',
    version: '1.0.0',
    register: async (server, options) => {

        server.route({
            method: 'GET',
            path: '/api/health',
            options: {
                auth: false,
                description: 'Liveness probe',
                tags: ['api', 'health']
            },
            handler: (request, h) => ({ status: 'ok', uptime: process.uptime() })
        });
    }
};

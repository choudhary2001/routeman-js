'use strict';

const { init } = require('./lib/server');

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
});

init()
    .then((server) => {
        console.log(`Server running on ${server.info.uri}`);
    });

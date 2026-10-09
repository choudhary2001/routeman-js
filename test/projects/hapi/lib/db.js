'use strict';

const Bcrypt = require('bcryptjs');

const users = [
    {
        id: 1,
        email: 'admin@example.com',
        username: 'admin',
        passwordHash: Bcrypt.hashSync('Str0ngPassw0rd!', 8),
        role: 'admin',
        createdAt: new Date().toISOString()
    }
];

const notes = [
    {
        id: 1,
        ownerId: 1,
        title: 'Welcome',
        content: 'Your first note. Edit or delete it whenever you like.',
        tags: ['getting-started'],
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
];

const nextId = (collection) => collection.reduce((max, row) => Math.max(max, row.id), 0) + 1;

const toPublicUser = ({ passwordHash, ...user }) => user;

module.exports = { users, notes, nextId, toPublicUser };

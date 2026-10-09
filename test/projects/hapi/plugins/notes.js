'use strict';

const Boom = require('@hapi/boom');
const Joi = require('joi');

const { notes, nextId } = require('../lib/db');
const { failAction } = require('../lib/validation');

const noteId = Joi.object({ noteId: Joi.number().integer().positive().required() });

const noteSchema = {
    title: Joi.string().trim().min(1).max(200),
    content: Joi.string().allow('').max(10000),
    tags: Joi.array().items(Joi.string().max(30)).max(10),
    archived: Joi.boolean()
};

const loadNote = (request) => {

    const { user } = request.auth.credentials;
    const note = notes.find((n) => n.id === request.params.noteId);

    if (!note || (note.ownerId !== user.id && user.role !== 'admin')) {
        throw Boom.notFound('Note not found');
    }

    return note;
};

const list = (request, h) => {

    const { user } = request.auth.credentials;
    const { q, tag, archived, sort } = request.query;

    let result = notes.filter((n) => user.role === 'admin' || n.ownerId === user.id);

    if (q) {
        const needle = q.toLowerCase();
        result = result.filter((n) => n.title.toLowerCase().includes(needle) || n.content.toLowerCase().includes(needle));
    }

    if (tag) {
        result = result.filter((n) => n.tags.includes(tag));
    }

    if (archived !== undefined) {
        result = result.filter((n) => n.archived === archived);
    }

    if (sort === 'title') {
        result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    }

    return result;
};

exports.plugin = {
    name: 'notes',
    version: '1.0.0',
    register: async (server, options) => {

        server.route([
            {
                method: 'GET',
                path: '/',
                handler: list,
                options: {
                    description: 'List notes',
                    notes: 'Supports full-text search, tag and archive filters',
                    tags: ['api', 'notes'],
                    validate: {
                        query: Joi.object({
                            q: Joi.string().max(100),
                            tag: Joi.string(),
                            archived: Joi.boolean(),
                            sort: Joi.string().valid('title', 'createdAt')
                        }),
                        failAction
                    }
                }
            },
            {
                method: 'GET',
                path: '/{noteId}',
                handler: (request, h) => loadNote(request),
                options: {
                    description: 'Get one note',
                    tags: ['api', 'notes'],
                    validate: { params: noteId, failAction }
                }
            },
            {
                method: 'POST',
                path: '/',
                handler: (request, h) => {

                    const now = new Date().toISOString();
                    const note = {
                        id: nextId(notes),
                        ownerId: request.auth.credentials.user.id,
                        title: request.payload.title,
                        content: request.payload.content || '',
                        tags: request.payload.tags || [],
                        archived: request.payload.archived || false,
                        createdAt: now,
                        updatedAt: now
                    };
                    notes.push(note);

                    return h.response(note).code(201).header('Location', `/api/notes/${note.id}`);
                },
                options: {
                    description: 'Create a note',
                    tags: ['api', 'notes'],
                    validate: {
                        payload: Joi.object({
                            ...noteSchema,
                            title: noteSchema.title.required()
                        }),
                        failAction
                    }
                }
            },
            {
                method: 'PUT',
                path: '/{noteId}',
                handler: (request, h) => {

                    const note = loadNote(request);
                    Object.assign(note, request.payload, { updatedAt: new Date().toISOString() });
                    return note;
                },
                options: {
                    description: 'Update a note',
                    tags: ['api', 'notes'],
                    validate: {
                        params: noteId,
                        payload: Joi.object(noteSchema).min(1),
                        failAction
                    }
                }
            },
            {
                method: 'DELETE',
                path: '/{noteId}',
                handler: (request, h) => {

                    const note = loadNote(request);
                    notes.splice(notes.indexOf(note), 1);
                    return h.response().code(204);
                },
                options: {
                    description: 'Delete a note',
                    tags: ['api', 'notes'],
                    validate: { params: noteId, failAction }
                }
            }
        ]);
    }
};

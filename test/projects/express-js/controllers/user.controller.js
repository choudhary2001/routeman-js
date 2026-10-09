const bcrypt = require('bcryptjs');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const { db, nextId } = require('../data/store');
const { sanitizeUser } = require('../utils/tokens');

const findUser = (id) => db.users.find((u) => u.id === Number(id));

const canAccess = (currentUser, targetId) => currentUser.role === 'admin' || currentUser.id === Number(targetId);

// @desc    Get all users
// @route   GET /api/v1/users
// @access  Private/Admin
exports.getUsers = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const { role, search } = req.query;

  let users = db.users;
  if (role) users = users.filter((u) => u.role === role);
  if (search) {
    const term = search.toLowerCase();
    users = users.filter((u) => u.username.includes(term) || u.email.includes(term) || (u.name || '').toLowerCase().includes(term));
  }

  const start = (page - 1) * limit;
  res.status(200).json({
    success: true,
    count: users.length,
    pagination: { page, limit, pages: Math.ceil(users.length / limit) },
    data: users.slice(start, start + limit).map(sanitizeUser),
  });
});

// @desc    Get single user
// @route   GET /api/v1/users/:id
// @access  Private (self or admin)
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = findUser(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }
  if (!canAccess(req.user, user.id)) {
    return next(new ErrorResponse('Not authorized to view this user', 403));
  }
  res.status(200).json({ success: true, data: sanitizeUser(user) });
});

// @desc    Create user
// @route   POST /api/v1/users
// @access  Private/Admin
exports.createUser = asyncHandler(async (req, res, next) => {
  const { username, email, password, name, role = 'user' } = req.body;
  const normalizedEmail = email.toLowerCase();

  if (db.users.some((u) => u.email === normalizedEmail || u.username === username)) {
    return next(new ErrorResponse('A user with that email or username already exists', 409));
  }

  const user = {
    id: nextId('users'),
    name: name || username,
    username,
    email: normalizedEmail,
    password: await bcrypt.hash(password, 10),
    role,
    avatar: null,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);

  res.status(201).json({ success: true, data: sanitizeUser(user) });
});

// @desc    Update user
// @route   PUT /api/v1/users/:id
// @access  Private (self or admin)
exports.updateUser = asyncHandler(async (req, res, next) => {
  const user = findUser(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }
  if (!canAccess(req.user, user.id)) {
    return next(new ErrorResponse('Not authorized to update this user', 403));
  }

  const { name, username, email, role } = req.body || {};

  if (email && db.users.some((u) => u.id !== user.id && u.email === email.toLowerCase())) {
    return next(new ErrorResponse('Email already in use', 409));
  }
  if (username && db.users.some((u) => u.id !== user.id && u.username === username)) {
    return next(new ErrorResponse('Username already in use', 409));
  }

  if (name !== undefined) user.name = name;
  if (username !== undefined) user.username = username;
  if (email !== undefined) user.email = email.toLowerCase();
  // only admins can change roles
  if (role !== undefined && req.user.role === 'admin') user.role = role;
  user.updatedAt = new Date().toISOString();

  res.status(200).json({ success: true, data: sanitizeUser(user) });
});

// @desc    Delete user
// @route   DELETE /api/v1/users/:id
// @access  Private/Admin
exports.deleteUser = asyncHandler(async (req, res, next) => {
  const index = db.users.findIndex((u) => u.id === Number(req.params.id));
  if (index === -1) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }
  db.users.splice(index, 1);
  res.status(200).json({ success: true, data: {} });
});

// @desc    Upload profile picture
// @route   POST /api/v1/users/:id/avatar
// @access  Private (self or admin)
exports.uploadAvatar = asyncHandler(async (req, res, next) => {
  const user = findUser(req.params.id);
  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }
  if (!canAccess(req.user, user.id)) {
    return next(new ErrorResponse('Not authorized to update this user', 403));
  }
  if (!req.file) {
    return next(new ErrorResponse('Please upload a file in the "avatar" field', 400));
  }

  user.avatar = `/uploads/avatars/${req.file.filename}`;
  res.status(200).json({ success: true, data: { avatar: user.avatar } });
});

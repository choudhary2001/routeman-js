const express = require('express');
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  uploadAvatar,
} = require('../controllers/user.controller');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { idRule, listUsersRules, createUserRules, updateUserRules } = require('../validators/user.validator');

const router = express.Router();

// every route below requires a logged-in user
router.use(protect);

router
  .route('/')
  .get(authorize('admin'), listUsersRules, validate, getUsers)
  .post(authorize('admin'), createUserRules, validate, createUser);

router
  .route('/:id')
  .get(idRule, validate, getUser)
  .put(updateUserRules, validate, updateUser)
  .delete(authorize('admin'), idRule, validate, deleteUser);

router.post('/:id/avatar', idRule, validate, upload.single('avatar'), uploadAvatar);

module.exports = router;

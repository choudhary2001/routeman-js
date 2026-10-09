const express = require('express');
const { register, login, refreshToken, getMe, logout } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { registerRules, loginRules, refreshRules, logoutRules } = require('../validators/auth.validator');

const router = express.Router();

router.post('/register', registerRules, validate, register);
router.post('/login', loginRules, validate, login);
router.post('/refresh-token', refreshRules, validate, refreshToken);
router.get('/me', protect, getMe);
router.post('/logout', protect, logoutRules, validate, logout);

module.exports = router;

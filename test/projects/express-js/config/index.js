const path = require('path');

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  jwt: {
    secret: process.env.JWT_SECRET || 'test-secret',
    expiresIn: process.env.JWT_EXPIRE || '1h',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'test-refresh-secret',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
  },
  uploads: {
    dir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
    maxFileSize: 2 * 1024 * 1024,
  },
};

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const ErrorResponse = require('../utils/errorResponse');

const avatarDir = path.join(config.uploads.dir, 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar_${req.params.id}_${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    return cb(null, true);
  }
  cb(new ErrorResponse('Please upload an image file', 400));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.uploads.maxFileSize },
});

module.exports = upload;

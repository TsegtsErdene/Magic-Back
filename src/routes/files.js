const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const filesController = require('../controllers/files');

router.post('/upload', upload.single('file'), filesController.uploadFile);
router.get('/', filesController.listFiles);
router.get('/url', filesController.getFileUrl);

module.exports = router;

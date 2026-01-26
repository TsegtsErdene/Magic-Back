const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require("../middleware/authMiddleware");
const upload = multer({ storage: multer.memoryStorage() });

const filesController = require('../controllers/files');

router.post('/upload', authMiddleware, upload.single('file'), filesController.uploadFile);
router.get('/', authMiddleware, filesController.listFiles);
router.get('/url', filesController.getFileUrl);
router.post('/assign-project', authMiddleware, filesController.assignProjectToFiles);

module.exports = router;

const express = require('express');
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");

const categriesController = require('../controllers/categories');

router.get('/', authMiddleware, categriesController.listCategories);

module.exports = router;

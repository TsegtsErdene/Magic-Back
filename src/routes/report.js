const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { reportController } = require("../controllers/report");

router.get("/",authMiddleware, reportController);

module.exports = router;

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { listTemplateFiles } = require("../controllers/sharepointTemplates");

router.get("/",authMiddleware, listTemplateFiles);

module.exports = router;

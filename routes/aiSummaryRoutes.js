const express = require("express")
const { protect } = require("../middlewares/authMiddleware.js")
const { generateAISummary } = require("../controller/aiSummaryController.js")

const router = express.Router();

router.get("/", protect, generateAISummary)

module.exports = router

const express = require("express")
const { protect } = require("../middlewares/authMiddleware.js")
const { aiSummaryRateLimiter } = require("../middlewares/rateLimitMiddleware.js")
const { generateAISummary } = require("../controller/aiSummaryController.js")

const router = express.Router();

router.get("/", protect, aiSummaryRateLimiter, generateAISummary)

module.exports = router

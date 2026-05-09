const express = require("express")
const { protect } = require("../../shared/middlewares/auth.middleware.js")
const { aiSummaryRateLimiter } = require("../../shared/middlewares/rate-limit.middleware.js")
const { generateAISummary } = require("./ai.controller.js")

const router = express.Router();

router.get("/", protect, aiSummaryRateLimiter, generateAISummary)

module.exports = router

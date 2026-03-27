const express = require("express");
const { protect } = require("../middlewares/authMiddleware.js");
const { summarySendRateLimiter } = require("../middlewares/rateLimitMiddleware.js");
const {
    getSummaryHistory,
    sendSummaryNow,
} = require("../controller/summaryDeliveryController.js");

const router = express.Router();

router.get("/history", protect, getSummaryHistory);
router.post("/send", protect, summarySendRateLimiter, sendSummaryNow);

module.exports = router;

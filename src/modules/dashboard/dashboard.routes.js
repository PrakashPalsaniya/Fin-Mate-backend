const express = require("express")
const { protect } = require("../../shared/middlewares/auth.middleware.js")
const { getDashboardData } = require("./dashboard.controller.js")

const router = express.Router();

router.get("/", protect, getDashboardData)

module.exports = router
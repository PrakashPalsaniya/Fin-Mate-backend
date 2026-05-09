const express = require("express");
const passport = require("../../shared/config/passport.js");
const {
    createGoogleAuthState,
    exchangeGoogleCode,
    getUserInfo,
    googleAuthCallback,
    loginUser,
    registerUser,
    sendOTP,
    validateGoogleAuthState,
    verifyOTPAndRegister,
    logout,
    refreshAccessToken,
} = require("./auth.controller.js");
const { protect } = require("../../shared/middlewares/auth.middleware.js");
const {
    googleCodeExchangeRateLimiter,
    loginRateLimiter,
    otpSendRateLimiter,
    otpVerifyRateLimiter,
} = require("../../shared/middlewares/rate-limit.middleware.js");

const router = express.Router();
const loginFailureRedirect = `${String(
    process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:5173"
)
    .trim()
    .replace(/\/+$/, "")}/login`;

router.post("/register", registerUser);
router.post("/send-otp", otpSendRateLimiter, sendOTP);
router.post("/verify-otp", otpVerifyRateLimiter, verifyOTPAndRegister);
router.post("/login", loginRateLimiter, loginUser);
router.post("/logout", logout);
router.post("/refresh-token", refreshAccessToken);
router.get("/getUser", protect, getUserInfo);

router.get(
    "/google",
    createGoogleAuthState,
    (req, res, next) =>
        passport.authenticate("google", {
            scope: ["profile", "email"],
            session: false,
            state: req.googleOAuthState,
        })(req, res, next)
);

router.get(
    "/google/callback",
    validateGoogleAuthState,
    (req, res, next) =>
        passport.authenticate("google", {
            failureRedirect: loginFailureRedirect,
            session: false,
        })(req, res, next),
    googleAuthCallback
);

router.get("/exchange-google-code", googleCodeExchangeRateLimiter, exchangeGoogleCode);

module.exports = router;

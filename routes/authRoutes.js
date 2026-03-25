const express = require("express")
const passport = require("../config/passport.js")
const { protect } = require("../middlewares/authMiddleware.js")
const upload = require("../middlewares/uploadMiddleware.js");

const {
    registerUser,
    loginUser,
    getUserInfo,
    googleAuthCallback,
    exchangeGoogleCode,
    sendOTP,
    verifyOTPAndRegister,
} = require("../controller/authController.js");

const router = express.Router();
const loginFailureRedirect = `${process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:5173"}/login`;

router.post("/register", registerUser);
router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTPAndRegister);
router.post("/login", loginUser);
router.get("/getUser", protect, getUserInfo);

// Google OAuth routes
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get("/google/callback", passport.authenticate("google", { failureRedirect: loginFailureRedirect }), googleAuthCallback);
router.get("/exchange-google-code", exchangeGoogleCode);
router.post("/upload-image", upload.single("image"), (req, res)=>{
    if (!req.file) {
        return res.status(409).json({message: "no file uploaded"})
    }
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`

    res.status(200).json({imageUrl})
})

module.exports = router

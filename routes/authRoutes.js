const express = require("express")
const passport = require("../config/passport.js")
const { protect } = require("../middlewares/authMiddleware.js")
const upload = require("../middlewares/uploadMiddleware.js");

const {
    registerUser,
    loginUser,
    getUserInfo,
    googleAuthCallback,
    sendOTP,
    verifyOTPAndRegister,
} = require("../controller/authController.js");

const router = express.Router();

router.post("/register", registerUser);
router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTPAndRegister);
router.post("/login", loginUser);
router.get("/getUser", protect, getUserInfo);

// Google OAuth routes
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get("/google/callback", passport.authenticate("google", { failureRedirect: "/login" }), googleAuthCallback);
router.post("/upload-image", upload.single("image"), (req, res)=>{
    if (!req.file) {
        return res.status(409).json({message: "no file uploaded"})
    }
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`

    res.status(200).json({imageUrl})
})

module.exports = router
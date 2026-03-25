const User = require("../models/User.js")
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { generateOTP, storeOTP, verifyOTP, sendOTPEmail } = require("../utils/otpUtils.js");
const redis = require("../config/redis.js");
const { serializeUser } = require("../utils/serializeUser.js");

const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || "7d").trim();

// Generates JWT token
const generateToken = (id) => {
    return jwt.sign({id}, process.env.JWT_SECRET, {expiresIn: JWT_EXPIRES_IN})
}

const OAUTH_CODE_TTL_SECONDS = Number(process.env.OAUTH_CODE_TTL_SECONDS || 300);

const normalizeEmail = (email = "") => email.trim().toLowerCase();

// Send OTP for signup
exports.sendOTP = async (req, res) => {
    const email = normalizeEmail(req.body.email);

    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }

    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use" });
        }

        // Generate and store OTP
        const otp = generateOTP();
        await storeOTP(email, otp);

        // Send OTP email
        await sendOTPEmail(email, otp);

        res.status(200).json({ message: "OTP sent successfully" });
    } catch (err) {
        console.error('Send OTP error:', err);
        res.status(500).json({ message: "Error sending OTP", error: err.message });
    }
};

// Verify OTP and register user
exports.verifyOTPAndRegister = async (req, res) => {
    const { fullName, password, profileImageUrl, otp } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!fullName || !email || !password || !otp) {
        return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }

    try {
        // Verify OTP
        const isValidOTP = await verifyOTP(email, otp);
        if (!isValidOTP) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        // Check if user already exists (double check)
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use" });
        }

        // Create user
        const user = await User.create({
            fullName,
            email,
            password,
            profileImageUrl,
            authProvider: 'local'
        });

        res.status(200).json({
            id: user._id,
            user: serializeUser(user),
            token: generateToken(user._id),
        });
    } catch (err) {
        console.error('Verify OTP and register error:', err);
        res.status(500).json({ message: "Error registering user", error: err.message });
    }
};

// Register User (legacy - keep for backward compatibility if needed)
exports.registerUser = async (req, res) => {
    const { fullName, password, profileImageUrl } = req.body;
    const email = normalizeEmail(req.body.email);

    if ( !fullName || !email || !password ) {
        return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }

    try {
        const existingUser = await User.findOne({email});
        if (existingUser) {return res.status(400).json({message: "email already in use"})}

        const user = await User.create({
            fullName,
            email,
            password,
            profileImageUrl,
            authProvider: 'local'
        });

        res.status(200).json({
            id: user._id,
            user: serializeUser(user),
            token: generateToken(user._id),
        });
    } catch (err) {
        res.status(500).json({message: "error registering user", error: err.message})
    }
}

// Login User
exports.loginUser = async (req, res) => {
    const password = req.body.password;
    const email = normalizeEmail(req.body.email);

    if (!email || !password) {
        return res.status(400).json({message: "All fields are required"})
    }

    try {
        const user = await User.findOne({email});
        if (!user) {
            return res.status(400).json({message: "Invalid credentials"})
        }

        if (user.authProvider === "google" && !user.password) {
            return res.status(400).json({ message: "This account uses Google sign-in. Please continue with Google." });
        }

        if (!(await user.comparePassword(password))) {
            return res.status(400).json({message: "Invalid credentials"})
        }

        res.status(200).json({
            id: user._id,
            user: serializeUser(user),
            token: generateToken(user._id),
        });
    } catch (err) {
        res.status(500).json({message: "error login user", error: err.message})
    }
}

// Get User Info
exports.getUserInfo = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {return res.status(400).json({message: "User not found"})}

        res.status(200).json({user: serializeUser(user)})
    } catch (err) {
        res.status(500).json({message: "error getting user", error: err.message})
    }
}

// Google OAuth callback
exports.googleAuthCallback = async (req, res) => {
    try {
        const user = req.user;
        const token = generateToken(user._id);
        const authCode = crypto.randomBytes(24).toString("hex");
        const payload = JSON.stringify({
            token,
            user: serializeUser(user),
        });

        await redis.setEx(`oauth:${authCode}`, OAUTH_CODE_TTL_SECONDS, payload);

        // Redirect to frontend with token
        const frontendUrl = process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:5173";
        const redirectUrl = `${frontendUrl}/auth/callback?code=${authCode}`;

        res.redirect(redirectUrl);
    } catch (error) {
        console.error('Google auth callback error:', error);
        res.status(500).json({ message: "Google authentication failed", error: error.message });
    }
}

exports.exchangeGoogleCode = async (req, res) => {
    const code = String(req.query.code || req.body.code || "").trim();

    if (!code) {
        return res.status(400).json({ message: "Authentication code is required" });
    }

    try {
        const key = `oauth:${code}`;
        const storedPayload = await redis.get(key);

        if (!storedPayload) {
            return res.status(400).json({ message: "Authentication code is invalid or expired" });
        }

        await redis.del(key);

        const parsedPayload = JSON.parse(storedPayload);
        return res.status(200).json(parsedPayload);
    } catch (error) {
        console.error("Exchange Google code error:", error);
        return res.status(500).json({ message: "Failed to complete Google authentication", error: error.message });
    }
}

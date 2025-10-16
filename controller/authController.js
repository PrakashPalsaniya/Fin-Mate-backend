const User = require("../models/User.js")
const jwt = require("jsonwebtoken");
const { generateOTP, storeOTP, verifyOTP, sendOTPEmail } = require("../utils/otpUtils.js");

// Generates JWT token
const generateToken = (id) => {
    return jwt.sign({id}, process.env.JWT_SECRET, {expiresIn: "1h"})
}

// Send OTP for signup
exports.sendOTP = async (req, res) => {
    const { email } = req.body;

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
    const { fullName, email, password, profileImageUrl, otp } = req.body;

    if (!fullName || !email || !password || !otp) {
        return res.status(400).json({ message: "All fields are required" });
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
            user,
            token: generateToken(user._id),
        });
    } catch (err) {
        console.error('Verify OTP and register error:', err);
        res.status(500).json({ message: "Error registering user", error: err.message });
    }
};

// Register User (legacy - keep for backward compatibility if needed)
exports.registerUser = async (req, res) => {
    const { fullName, email, password, profileImageUrl } = req.body;

    if ( !fullName || !email || !password ) {
        return res.status(400).json({ message: "All fields are required" });
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
            user,
            token: generateToken(user._id),
        });
    } catch (err) {
        res.status(500).json({message: "error registering user", error: err.message})
    }
}

// Login User
exports.loginUser = async (req, res) => {
    const {email, password} = req.body;

    if (!email || !password) {
        return res.status(400).json({message: "All fields are required"})
    }

    try {
        const user = await User.findOne({email});
        if (!user || !(await user.comparePassword(password))) {
            return res.status(400).json({message: "Invalid credentials"})
        }

        res.status(200).json({
            id: user._id,
            user,
            token: generateToken(user._id),
        });
    } catch (err) {
        res.status(500).json({message: "error login user", error: err.message})
    }
}

// Get User Info
exports.getUserInfo = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-password");

        if (!user) {return res.status(400).json({message: "User not found"})}

        res.status(200).json({user})
    } catch (err) {
        res.status(500).json({message: "error getting user", error: err.message})
    }
}

// Google OAuth callback
exports.googleAuthCallback = async (req, res) => {
    try {
        const user = req.user;
        const token = generateToken(user._id);

        // Redirect to frontend with token
        const frontendUrl = process.env.CLIENT_URL || "http://localhost:5173";
        const redirectUrl = `${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify({
            id: user._id,
            fullName: user.fullName,
            email: user.email,
            profileImageUrl: user.profileImageUrl,
            authProvider: user.authProvider
        }))}`;

        console.log('Redirecting to:', redirectUrl); // Debug log
        res.redirect(redirectUrl);
    } catch (error) {
        console.error('Google auth callback error:', error);
        res.status(500).json({ message: "Google authentication failed", error: error.message });
    }
}

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("./user.model.js");
const RefreshToken = require("./refreshToken.model.js");
const redis = require("../../shared/config/redis.js");
const { getClientIp } = require("../../shared/middlewares/rate-limit.middleware.js");
const { serializeUser } = require("./user.serializer.js");
const { generateOTP, sendOTPEmail, storeOTP, verifyOTP } = require("./auth.utils.js");

const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";

const OAUTH_CODE_TTL_SECONDS = Number(process.env.OAUTH_CODE_TTL_SECONDS || 300);
const GOOGLE_OAUTH_STATE_TTL_SECONDS = Number(
    process.env.GOOGLE_OAUTH_STATE_TTL_SECONDS || 300
);
const GOOGLE_OAUTH_STATE_COOKIE = "finmate_google_state";
const GOOGLE_OAUTH_STATE_PREFIX = "oauth_state:";
const isProduction = process.env.NODE_ENV === "production";

const normalizeEmail = (email = "") => String(email || "").trim().toLowerCase();
const getFrontendUrl = () =>
    String(process.env.CLIENT_URL || process.env.FRONTEND_URL || "http://localhost:5173")
        .trim()
        .replace(/\/+$/, "");

const getRequiredJwtSecret = () => {
    const secret = String(process.env.JWT_SECRET || "").trim();

    if (!secret) {
        throw new Error("JWT_SECRET is required");
    }

    return secret;
};

const generateAccessToken = (id) =>
    jwt.sign({ id }, getRequiredJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRES_IN });

const generateRefreshToken = async (user, ipAddress) => {
    const token = crypto.randomBytes(40).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const refreshToken = await RefreshToken.create({
        userId: user._id,
        token,
        expiresAt,
    });

    return refreshToken;
};

const parseExpirySeconds = (input) => {
    const s = String(input || "").trim();
    if (!s) return undefined;
    if (/^\d+$/.test(s)) return Number(s);
    const m = s.match(/^(\d+)([smhd])$/i);
    if (!m) return undefined;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === 's') return n;
    if (unit === 'm') return n * 60;
    if (unit === 'h') return n * 60 * 60;
    if (unit === 'd') return n * 24 * 60 * 60;
    return undefined;
};

const appendSetCookie = (res, cookieValue) => {
    const existingHeader = res.getHeader("Set-Cookie");

    if (!existingHeader) {
        res.setHeader("Set-Cookie", [cookieValue]);
        return;
    }

    const cookies = Array.isArray(existingHeader) ? existingHeader : [existingHeader];
    res.setHeader("Set-Cookie", [...cookies, cookieValue]);
};

const buildCookie = ({
    name,
    value,
    maxAgeSeconds,
    path = "/",
    httpOnly = true,
    // For cross-site cookies (e.g. Vercel frontend -> separate backend),
    // SameSite=None and Secure=true are REQUIRED.
    sameSite = isProduction ? "None" : "Lax",
    secure = isProduction,
    expires,
}) => {
    const parts = [
        `${name}=${encodeURIComponent(String(value || ""))}`,
        `Path=${path}`,
        `SameSite=${sameSite}`,
    ];

    if (httpOnly) {
        parts.push("HttpOnly");
    }

    if (secure) {
        parts.push("Secure");
    }

    if (typeof maxAgeSeconds === "number") {
        parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
    }

    if (expires instanceof Date) {
        parts.push(`Expires=${expires.toUTCString()}`);
    }

    return parts.join("; ");
};

const clearCookie = (res, name, path = "/") => {
    appendSetCookie(
        res,
        buildCookie({
            name,
            value: "",
            maxAgeSeconds: 0,
            expires: new Date(0),
            path,
        })
    );
};

const parseCookies = (cookieHeader = "") =>
    String(cookieHeader || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((cookies, part) => {
            const separatorIndex = part.indexOf("=");

            if (separatorIndex === -1) {
                return cookies;
            }

            const key = part.slice(0, separatorIndex).trim();
            const rawValue = part.slice(separatorIndex + 1).trim();
            cookies[key] = decodeURIComponent(rawValue);
            return cookies;
        }, {});

const safeCompareStrings = (left = "", right = "") => {
    const leftBuffer = Buffer.from(String(left || ""));
    const rightBuffer = Buffer.from(String(right || ""));

    if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const redirectToFrontendLogin = (res, errorCode) => {
    const params = errorCode
        ? `?error=${encodeURIComponent(String(errorCode))}`
        : "";

    return res.redirect(`${getFrontendUrl()}/login${params}`);
};

exports.sendOTP = async (req, res) => {
    const email = normalizeEmail(req.body.email);

    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }

    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use" });
        }

        const otp = generateOTP();

        await storeOTP(email, otp);
        await sendOTPEmail(email, otp);

        return res.status(200).json({
            message: "OTP sent successfully",
        });
    } catch (err) {
        console.error("Send OTP error:", err);
        return res.status(500).json({ message: "Error sending OTP" });
    }
};

exports.verifyOTPAndRegister = async (req, res) => {
    const { fullName, password, otp } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!fullName || !email || !password || !otp) {
        return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
    }

    try {
        const isValidOTP = await verifyOTP(email, otp);
        if (!isValidOTP) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use" });
        }

        const user = await User.create({
            fullName: String(fullName).trim(),
            email,
            password,
            authProvider: "local",
        });

        const accessToken = generateAccessToken(user._id);
        const refreshToken = await generateRefreshToken(user, getClientIp(req));

        appendSetCookie(
            res,
            buildCookie({
                name: "accessToken",
                value: accessToken,
                maxAgeSeconds: parseExpirySeconds(ACCESS_TOKEN_EXPIRES_IN) || 900,
                path: "/",
            })
        );

        appendSetCookie(
            res,
            buildCookie({
                name: "refreshToken",
                value: refreshToken.token,
                maxAgeSeconds: parseExpirySeconds(REFRESH_TOKEN_EXPIRES_IN) || 604800,
                path: "/",
            })
        );

        return res.status(200).json({
            id: user._id,
            user: serializeUser(user),
        });
    } catch (err) {
        console.error("Verify OTP and register error:", err);
        return res.status(500).json({ message: "Error registering user" });
    }
};

exports.registerUser = async (_req, res) =>
    res.status(410).json({
        message: "Direct registration has been disabled. Please request an OTP and verify your email first.",
    });

exports.loginUser = async (req, res) => {
    const password = req.body.password;
    const email = normalizeEmail(req.body.email);

    if (!email || !password) {
        return res.status(400).json({ message: "All fields are required" });
    }

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        if (user.authProvider === "google" && !user.password) {
            return res.status(400).json({
                message: "This account uses Google sign-in. Please continue with Google.",
            });
        }

        if (!(await user.comparePassword(password))) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        const accessToken = generateAccessToken(user._id);
        const refreshToken = await generateRefreshToken(user, getClientIp(req));

        appendSetCookie(
            res,
            buildCookie({
                name: "accessToken",
                value: accessToken,
                maxAgeSeconds: parseExpirySeconds(ACCESS_TOKEN_EXPIRES_IN) || 900,
                path: "/",
            })
        );

        appendSetCookie(
            res,
            buildCookie({
                name: "refreshToken",
                value: refreshToken.token,
                maxAgeSeconds: parseExpirySeconds(REFRESH_TOKEN_EXPIRES_IN) || 604800,
                path: "/",
            })
        );

        return res.status(200).json({
            id: user._id,
            user: serializeUser(user),
        });
    } catch (err) {
        return res.status(500).json({ message: "error login user", error: err.message });
    }
};

exports.getUserInfo = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(400).json({ message: "User not found" });
        }

        return res.status(200).json({ user: serializeUser(user) });
    } catch (err) {
        return res.status(500).json({ message: "error getting user", error: err.message });
    }
};

exports.createGoogleAuthState = async (req, res, next) => {
    try {
        const state = crypto.randomBytes(24).toString("hex");

        await redis.setEx(
            `${GOOGLE_OAUTH_STATE_PREFIX}${state}`,
            GOOGLE_OAUTH_STATE_TTL_SECONDS,
            JSON.stringify({
                createdAt: new Date().toISOString(),
                ip: getClientIp(req),
                userAgent: String(req.get("user-agent") || "").trim().slice(0, 300),
            })
        );

        appendSetCookie(
            res,
            buildCookie({
                name: GOOGLE_OAUTH_STATE_COOKIE,
                value: state,
                maxAgeSeconds: GOOGLE_OAUTH_STATE_TTL_SECONDS,
                path: "/api/v1/auth/google/callback",
            })
        );

        req.googleOAuthState = state;
        return next();
    } catch (error) {
        console.error("Failed to create Google OAuth state:", error);
        return redirectToFrontendLogin(res, "google_oauth_unavailable");
    }
};

exports.validateGoogleAuthState = async (req, res, next) => {
    const state = String(req.query.state || "").trim();
    const cookies = parseCookies(req.headers.cookie);
    const cookieState = String(cookies[GOOGLE_OAUTH_STATE_COOKIE] || "").trim();

    clearCookie(res, GOOGLE_OAUTH_STATE_COOKIE, "/api/v1/auth/google/callback");

    if (!state || !cookieState || !safeCompareStrings(state, cookieState)) {
        return redirectToFrontendLogin(res, "google_oauth_state_invalid");
    }

    try {
        const redisKey = `${GOOGLE_OAUTH_STATE_PREFIX}${state}`;
        const storedState = await redis.get(redisKey);
        await redis.del(redisKey);

        if (!storedState) {
            return redirectToFrontendLogin(res, "google_oauth_state_expired");
        }

        return next();
    } catch (error) {
        console.error("Failed to validate Google OAuth state:", error);
        return redirectToFrontendLogin(res, "google_oauth_state_error");
    }
};

exports.googleAuthCallback = async (req, res) => {
    try {
        const user = req.user;

        if (!user?._id) {
            return redirectToFrontendLogin(res, "google_auth_failed");
        }

        const accessToken = generateAccessToken(user._id);
        const refreshToken = await generateRefreshToken(user, getClientIp(req));

        const authCode = crypto.randomBytes(24).toString("hex");
        const payload = JSON.stringify({
            accessToken,
            refreshToken: refreshToken.token,
            user: serializeUser(user),
        });

        await redis.setEx(`oauth:${authCode}`, OAUTH_CODE_TTL_SECONDS, payload);

        return res.redirect(`${getFrontendUrl()}/auth/callback?code=${encodeURIComponent(authCode)}`);
    } catch (error) {
        console.error("Google auth callback error:", error);
        return redirectToFrontendLogin(res, "google_auth_failed");
    }
};

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

        // Set cookies when exchanging code
        appendSetCookie(
            res,
            buildCookie({
                name: "accessToken",
                value: parsedPayload.accessToken,
                maxAgeSeconds: parseExpirySeconds(ACCESS_TOKEN_EXPIRES_IN) || 900,
                path: "/",
            })
        );

        appendSetCookie(
            res,
            buildCookie({
                name: "refreshToken",
                value: parsedPayload.refreshToken,
                maxAgeSeconds: parseExpirySeconds(REFRESH_TOKEN_EXPIRES_IN) || 604800,
                path: "/",
            })
        );

        return res.status(200).json({
            id: parsedPayload.user.id,
            user: parsedPayload.user,
        });
    } catch (error) {
        console.error("Exchange Google code error:", error);
        return res.status(500).json({ message: "Failed to complete Google authentication" });
    }
};

// Logout: clear the auth cookies and revoke refresh token
exports.logout = async (req, res) => {
    try {
        const cookies = parseCookies(req.headers.cookie);
        const refreshToken = cookies.refreshToken;

        if (refreshToken) {
            const tokenDoc = await RefreshToken.findOne({ token: refreshToken });
            if (tokenDoc) {
                tokenDoc.revokedAt = new Date();
                await tokenDoc.save();
            }
        }

        clearCookie(res, 'accessToken', '/');
        clearCookie(res, 'refreshToken', '/');
        return res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
        console.error('Logout error:', error);
        clearCookie(res, 'accessToken', '/');
        clearCookie(res, 'refreshToken', '/');
        return res.status(500).json({ message: 'Failed to log out' });
    }
};

exports.refreshAccessToken = async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const refreshToken = cookies.refreshToken;

    if (!refreshToken) {
        return res.status(401).json({ message: "Refresh token not found" });
    }

    try {
        const tokenDoc = await RefreshToken.findOne({ token: refreshToken });

        if (!tokenDoc || !tokenDoc.isActive()) {
            // If token is invalid or already revoked, it might be a reuse attack.
            // In a production app, we might want to revoke all tokens for this user.
            if (tokenDoc && !tokenDoc.isActive()) {
                await RefreshToken.updateMany({ userId: tokenDoc.userId }, { revokedAt: new Date() });
            }
            return res.status(401).json({ message: "Invalid refresh token" });
        }

        // Rotate token: Issue new ones
        const user = await User.findById(tokenDoc.userId);
        if (!user) {
            return res.status(401).json({ message: "User not found" });
        }

        const newAccessToken = generateAccessToken(user._id);
        const newRefreshToken = await generateRefreshToken(user, getClientIp(req));

        // Mark old token as replaced
        tokenDoc.revokedAt = new Date();
        tokenDoc.replacedByToken = newRefreshToken.token;
        await tokenDoc.save();

        appendSetCookie(
            res,
            buildCookie({
                name: "accessToken",
                value: newAccessToken,
                maxAgeSeconds: parseExpirySeconds(ACCESS_TOKEN_EXPIRES_IN) || 900,
                path: "/",
            })
        );

        appendSetCookie(
            res,
            buildCookie({
                name: "refreshToken",
                value: newRefreshToken.token,
                maxAgeSeconds: parseExpirySeconds(REFRESH_TOKEN_EXPIRES_IN) || 604800,
                path: "/",
            })
        );

        return res.status(200).json({ message: "Token refreshed successfully" });
    } catch (error) {
        console.error("Refresh token error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

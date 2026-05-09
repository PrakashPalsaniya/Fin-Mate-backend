const jwt = require("jsonwebtoken")
const User = require("../../modules/auth/user.model.js")

exports.protect = async(req, res, next) => {
    let token = req.headers.authorization?.split(" ")[1];

    // Fallback to cookie named 'token' (HttpOnly cookie set by server)
    if (!token) {
        const cookieHeader = req.headers.cookie || "";
        const cookies = String(cookieHeader || "")
            .split(";")
            .map((p) => p.trim())
            .filter(Boolean)
            .reduce((acc, part) => {
                const idx = part.indexOf("=");
                if (idx === -1) return acc;
                const key = part.slice(0, idx).trim();
                const val = part.slice(idx + 1).trim();
                acc[key] = decodeURIComponent(val);
                return acc;
            }, {});

        token = cookies.token;
    }

    if (!token) {return res.status(401).json({message: "Not authorized, no token"})};

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select("-password");
        if (!req.user) {
            return res.status(401).json({ message: "Not authorized, user not found" });
        }
        next();
    } catch (err) {
        res.status(401).json({message: "Not authorized, token failed", error: err.message});
    }
}



// It checks the Authorization header for a Bearer token. If the token exists and is valid (verified against a secret key), it finds the corresponding user in the database, attaches their info to the request object (req.user), and allows the request to proceed. If the token is missing or invalid, it immediately sends a 401 Unauthorized error, blocking access to the route.

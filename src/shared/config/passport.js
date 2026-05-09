const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../../modules/auth/user.model.js");

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
        },
        async (_accessToken, _refreshToken, profile, done) => {
            try {
                const email = String(profile?.emails?.[0]?.value || "").trim().toLowerCase();

                if (!email) {
                    return done(new Error("Google account did not provide an email address"), null);
                }

                let user = await User.findOne({ googleId: profile.id });

                if (user) {
                    return done(null, user);
                }

                user = await User.findOne({ email });

                if (user) {
                    user.googleId = profile.id;
                    user.authProvider = "google";
                    await user.save();
                    return done(null, user);
                }

                user = new User({
                    googleId: profile.id,
                    fullName: String(profile?.displayName || "Google User").trim(),
                    email,
                    authProvider: "google",
                });

                await user.save();
                return done(null, user);
            } catch (error) {
                return done(error, null);
            }
        }
    )
);

module.exports = passport;

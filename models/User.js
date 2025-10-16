const mongoose = require("mongoose")

const bcryptjs = require("bcryptjs")

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true},
    email: { type: String, required:true, unique: true },
    password: { type: String, required: false },
    profileImageUrl: { type: String, default: null },
    googleId: { type: String, unique: true, sparse: true },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' }
    }, {
        timestamps: true
    }
);

// hash password before saving
userSchema.pre('save', async function (next) { // a Mongoose middleware runs before saving a user.
    if (!this.isModified('password') || !this.password) return next(); // If the password wasn't changed or not set, skip hashing
    this.password = await bcryptjs.hash(this.password, 10); // password is new or changed, hash it with 10 salt rounds (more secure).
    next(); // Move on and finish saving the user.
})

// compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcryptjs.compare(candidatePassword, this.password)
}

module.exports = mongoose.model("User", userSchema)
const nodemailer = require('nodemailer');
const client = require('../config/redis');

// Cleanup expired OTPs (optional - Redis handles expiration automatically)
const cleanupExpiredOTPs = async () => {
    // Redis automatically expires keys, but this could be used for logging or custom cleanup
    console.log('OTP cleanup check completed');
};

// Generate 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store OTP in Redis with expiration (5 minutes)
const storeOTP = async (email, otp) => {
    try {
        const key = `otp:${email}`;
        const expiresIn = 300; // 5 minutes in seconds
        await client.setEx(key, expiresIn, otp);
        console.log(`OTP stored for ${email} (${client.isConnected() ? 'Redis' : 'In-memory'})`);
    } catch (error) {
        console.error('Error storing OTP:', error);
        throw error;
    }
};

// Verify OTP from Redis
const verifyOTP = async (email, otp) => {
    try {
        const key = `otp:${email}`;
        const storedOTP = await client.get(key);

        if (storedOTP === otp) {
            // Delete OTP after successful verification
            await client.del(key);
            console.log(`OTP verified and deleted for ${email} (${client.isConnected() ? 'Redis' : 'In-memory'})`);
            return true;
        }
        console.log(`OTP verification failed for ${email}`);
        return false;
    } catch (error) {
        console.error('Error verifying OTP:', error);
        throw error;
    }
};

// Send OTP via email
const sendOTPEmail = async (email, otp) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS, // App password for Gmail
        },
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your OTP for Signup - Expense Tracker',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
                    <h1 style="color: white; margin: 0; font-size: 28px;">Expense Tracker</h1>
                    <p style="color: #e8e8e8; margin: 5px 0 0 0;">Account Verification</p>
                </div>

                <div style="background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 30px; text-align: center;">
                    <h2 style="color: #333; margin-bottom: 20px;">Verify Your Email</h2>
                    <p style="color: #666; margin-bottom: 30px; line-height: 1.6;">
                        Thank you for signing up! Please use the following One-Time Password (OTP) to complete your registration:
                    </p>

                    <div style="background-color: #f8f9fa; border: 2px solid #007bff; border-radius: 8px; padding: 25px; margin: 20px 0; display: inline-block;">
                        <h1 style="color: #007bff; font-size: 36px; margin: 0; letter-spacing: 5px; font-weight: bold;">${otp}</h1>
                    </div>

                    <p style="color: #dc3545; font-weight: bold; margin: 20px 0;">
                        This OTP will expire in 5 minutes.
                    </p>

                    <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0;">
                        <p style="color: #856404; margin: 0; font-size: 14px;">
                            <strong>Security Note:</strong> Do not share this OTP with anyone. Our team will never ask for your OTP.
                        </p>
                    </div>

                    <p style="color: #666; font-size: 14px; margin-top: 30px;">
                        If you didn't request this verification, please ignore this email.
                    </p>
                </div>

                <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
                    <p style="color: #999; font-size: 12px; margin: 0;">
                        This is an automated message from Expense Tracker. Please do not reply to this email.
                    </p>
                    <p style="color: #999; font-size: 12px; margin: 5px 0 0 0;">
                        © 2024 Expense Tracker. All rights reserved.
                    </p>
                </div>
            </div>
        `,
    };

    await transporter.sendMail(mailOptions);
};

module.exports = {
    generateOTP,
    storeOTP,
    verifyOTP,
    sendOTPEmail,
};

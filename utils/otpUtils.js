const brevo = require("@getbrevo/brevo");

const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

const client = require('../config/redis');
const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 300);

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
        await client.setEx(key, OTP_TTL_SECONDS, otp);
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
  const sendSmtpEmail = new brevo.SendSmtpEmail();

  sendSmtpEmail.subject = "Your OTP Code";
  sendSmtpEmail.htmlContent = `
    <div style="font-family:Arial,sans-serif;padding:20px">
      <h2>OTP Verification</h2>
      <p>Your One-Time Password (OTP) is:</p>
      <h3 style="color:#007BFF">${otp}</h3>
      <p>This code is valid for ${Math.max(1, Math.round(OTP_TTL_SECONDS / 60))} minutes.</p>
    </div>
  `;
  sendSmtpEmail.sender = { name: "FinMate", email: "pkjat6376060840@gmail.com" };
  sendSmtpEmail.to = [{ email: email }];

  await apiInstance.sendTransacEmail(sendSmtpEmail);
};

module.exports = {
    generateOTP,
    storeOTP,
    verifyOTP,
    sendOTPEmail,
};

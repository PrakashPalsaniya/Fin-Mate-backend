const brevo = require("@getbrevo/brevo");

const DEFAULT_SENDER_NAME = process.env.BREVO_SENDER_NAME || "FinMate";
const DEFAULT_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "pkjat6376060840@gmail.com";

const getBrevoApiInstance = () => {
    if (!process.env.BREVO_API_KEY) {
        const error = new Error("BREVO_API_KEY is required to send summary emails.");
        error.status = 503;
        throw error;
    }

    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(
        brevo.TransactionalEmailsApiApiKeys.apiKey,
        process.env.BREVO_API_KEY
    );

    return apiInstance;
};

const normalizeRecipients = (to) =>
    (Array.isArray(to) ? to : [to])
        .map((item) =>
            typeof item === "string"
                ? { email: item }
                : { email: item.email, name: item.name }
        )
        .filter((item) => item.email);

const sendEmail = async ({ to, subject, htmlContent, textContent }) => {
    const recipients = normalizeRecipients(to);

    if (recipients.length === 0) {
        const error = new Error("At least one recipient email is required.");
        error.status = 400;
        throw error;
    }

    if (!DEFAULT_SENDER_EMAIL) {
        const error = new Error("BREVO_SENDER_EMAIL is required to send summary emails.");
        error.status = 503;
        throw error;
    }

    const apiInstance = getBrevoApiInstance();
    const sendSmtpEmail = new brevo.SendSmtpEmail();

    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.textContent = textContent;
    sendSmtpEmail.sender = {
        name: DEFAULT_SENDER_NAME,
        email: DEFAULT_SENDER_EMAIL,
    };
    sendSmtpEmail.to = recipients;

    return apiInstance.sendTransacEmail(sendSmtpEmail);
};

module.exports = {
    sendEmail,
};

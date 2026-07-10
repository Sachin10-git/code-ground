require("./db/config/env");

const { sendEmail } = require("./services/email.service");

(async () => {
    try {

        await sendEmail({
            to: process.env.EMAIL_USER,
            subject: "Code Ground Test",
            html: "<h2>Email service is working! 🚀</h2>",
        });

        console.log("Email sent successfully.");

    } catch (err) {
        console.error(err);
    }
})();
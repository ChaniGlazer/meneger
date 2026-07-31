const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "no-reply@codebloom.app";
const FROM_NAME = process.env.RESEND_FROM_NAME || "Codebloom";

async function sendEmail({ to, toName, subject, html, text }) {
  if (!RESEND_API_KEY) {
    throw new Error("שירות שליחת האימייל אינו מוגדר בשרת (RESEND_API_KEY חסר)");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [toName ? `${toName} <${to}>` : to],
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`שליחת האימייל נכשלה (${res.status}): ${body.slice(0, 300)}`);
  }
}

module.exports = { sendEmail };

const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    },
    tls: { rejectUnauthorized: false }
  });
}

async function sendPasswordResetEmail(teacher, resetToken) {
  const transporter = createTransport();
  const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/auth/teacher/reset-password/${resetToken}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #f1f5f9; margin:0; padding:20px; }
        .container { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
        .header { background: linear-gradient(135deg, #0f172a, #1a56db); padding: 32px 40px; text-align: center; }
        .header img { width: 64px; height: 64px; border-radius: 50%; margin-bottom: 12px; }
        .header h1 { color: #fff; margin: 0; font-size: 22px; }
        .header p { color: #93c5fd; margin: 4px 0 0; font-size: 13px; }
        .body { padding: 32px 40px; }
        .body h2 { color: #1e293b; font-size: 18px; margin: 0 0 12px; }
        .body p { color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 16px; }
        .btn { display: inline-block; padding: 13px 28px; background: #1a56db; color: #fff !important; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; }
        .warning { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #9a3412; margin-top: 20px; }
        .footer { background: #f8fafc; padding: 20px 40px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎓 Canon Andrea Mwaka School</h1>
          <p>Password Reset Request</p>
        </div>
        <div class="body">
          <h2>Hello, ${teacher.fullName}</h2>
          <p>A password reset was requested for your Canon Andrea Mwaka School teacher account. Click the button below to set a new password:</p>
          <p style="text-align:center">
            <a href="${resetUrl}" class="btn">Reset My Password</a>
          </p>
          <p>Or copy this link into your browser:</p>
          <p style="word-break:break-all; font-size:12px; color:#64748b">${resetUrl}</p>
          <div class="warning">
            ⚠️ This link expires in <strong>1 hour</strong>. If you did not request a password reset, please ignore this email.
          </div>
        </div>
        <div class="footer">
          Canon Andrea Mwaka School Management System · Do not reply to this email
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || 'Canon Andrea Mwaka School <noreply@school.edu>',
    to: `${teacher.fullName} <${teacher.email}>`,
    subject: 'Canon Andrea Mwaka School — Password Reset Request',
    html
  });
}

module.exports = { sendPasswordResetEmail };

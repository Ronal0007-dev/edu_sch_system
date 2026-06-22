'use strict';
require('dotenv').config();
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const nodemailer = require('nodemailer');

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || './backups');

// ── Ensure backup directory exists ────────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ── Run mysqldump ──────────────────────────────────────────────────────────────
function dumpDatabase() {
  return new Promise((resolve, reject) => {
    ensureDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sqlFile = path.join(BACKUP_DIR, `backup-${ts}.sql`);
    const zipFile = path.join(BACKUP_DIR, `backup-${ts}.zip`);

    const host = process.env.DB_HOST || 'localhost';
    const user = process.env.DB_USER || 'root';
    const pass = process.env.DB_PASS || '';
    const db   = process.env.DB_NAME || 'school_system';

    // Build mysqldump command — password passed via env var to avoid shell warning
    const passEnv = pass ? `MYSQL_PWD="${pass}"` : '';
    const cmd = `${passEnv} mysqldump -h ${host} -u ${user} --single-transaction --routines --triggers ${db} > "${sqlFile}"`;

    exec(cmd, { shell: '/bin/bash' }, async (err) => {
      if (err) {
        // Clean up empty file if dump failed
        if (fs.existsSync(sqlFile)) fs.unlinkSync(sqlFile);
        return reject(new Error('mysqldump failed: ' + err.message));
      }

      // Zip the SQL file
      try {
        await zipFile_(sqlFile, zipFile);
        fs.unlinkSync(sqlFile); // Remove raw SQL after zipping
        resolve({ zipFile, ts });
      } catch (zipErr) {
        reject(zipErr);
      }
    });
  });
}

// ── Zip a single file ──────────────────────────────────────────────────────────
function zipFile_(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(inputPath, { name: path.basename(inputPath) });
    archive.finalize();
  });
}

// ── Send email with backup attachment ─────────────────────────────────────────
async function sendBackupEmail(zipFile, ts) {
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    },
    tls: { rejectUnauthorized: false }
  });

  const recipient = process.env.BACKUP_EMAIL || process.env.MAIL_USER;
  const dateStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const fileSize = (fs.statSync(zipFile).size / 1024).toFixed(1);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #f1f5f9; margin:0; padding:20px; }
        .container { max-width: 520px; margin:0 auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,.08); }
        .header { background: linear-gradient(135deg,#0f172a,#1a56db); padding:28px 36px; }
        .header h1 { color:#fff; margin:0; font-size:20px; }
        .header p { color:#93c5fd; margin:4px 0 0; font-size:13px; }
        .body { padding:28px 36px; }
        .body h2 { color:#1e293b; font-size:16px; margin:0 0 12px; }
        .body p { color:#475569; font-size:14px; line-height:1.6; margin:0 0 12px; }
        .info-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 18px; margin:16px 0; }
        .info-row { display:flex; justify-content:space-between; font-size:13px; padding:4px 0; border-bottom:1px solid #f1f5f9; }
        .info-row:last-child { border-bottom:none; }
        .info-label { color:#64748b; font-weight:600; }
        .info-value { color:#1e293b; font-weight:700; }
        .footer { background:#f8fafc; padding:18px 36px; text-align:center; font-size:12px; color:#94a3b8; border-top:1px solid #e2e8f0; }
        .attach-note { background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px 16px; font-size:13px; color:#1d4ed8; margin-top:16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎓 Canon Andrea Mwaka School</h1>
          <p>Automatic Database Backup</p>
        </div>
        <div class="body">
          <h2>Scheduled Backup Complete</h2>
          <p>Your Canon Andrea Mwaka School database has been automatically backed up. Please find the backup file attached to this email.</p>
          <div class="info-box">
            <div class="info-row">
              <span class="info-label">Date</span>
              <span class="info-value">${dateStr}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Database</span>
              <span class="info-value">${process.env.DB_NAME || 'school_system'}</span>
            </div>
            <div class="info-row">
              <span class="info-label">File</span>
              <span class="info-value">${path.basename(zipFile)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Size</span>
              <span class="info-value">${fileSize} KB (compressed)</span>
            </div>
            <div class="info-row">
              <span class="info-label">Next Backup</span>
              <span class="info-value">In 7 days</span>
            </div>
          </div>
          <div class="attach-note">
            📎 The backup file <strong>${path.basename(zipFile)}</strong> is attached to this email. Store it in a safe location.
          </div>
        </div>
        <div class="footer">
          Canon Andrea Mwaka School Management System · Automated Backup Service
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || 'Canon Andrea Mwaka School <cams.admission@gmail.com>',
    to: recipient,
    subject: `Canon Andrea Mwaka School Database Backup — ${dateStr}`,
    html,
    attachments: [{
      filename: path.basename(zipFile),
      path: zipFile,
      contentType: 'application/zip'
    }]
  });

  console.log(`✅ Backup email sent to ${recipient}`);
}

// ── Delete old backups (keep last 4 = 1 month) ────────────────────────────────
function pruneOldBackups() {
  try {
    ensureDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.zip'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    // Keep the 4 most recent, delete the rest
    files.slice(4).forEach(f => {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      console.log(`🗑  Pruned old backup: ${f.name}`);
    });
  } catch (e) {
    console.error('Prune error:', e.message);
  }
}

// ── Main backup function ───────────────────────────────────────────────────────
async function runBackup(manual = false) {
  const label = manual ? 'Manual' : 'Scheduled';
  console.log(`\n🔄 [${new Date().toISOString()}] ${label} backup starting...`);
  try {
    const { zipFile, ts } = await dumpDatabase();
    console.log(`✅ Database dumped: ${path.basename(zipFile)}`);
    await sendBackupEmail(zipFile, ts);
    pruneOldBackups();
    console.log(`✅ ${label} backup complete.\n`);
    return { success: true, file: path.basename(zipFile) };
  } catch (err) {
    console.error(`❌ ${label} backup failed:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { runBackup, pruneOldBackups };

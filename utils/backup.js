'use strict';
require('dotenv').config();
const mysql = require('mysql2');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const nodemailer = require('nodemailer');

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || './backups');
const BACKUP_LOCK = path.join(BACKUP_DIR, '.backup.lock');
const STALE_LOCK_AGE_MS = 24 * 60 * 60 * 1000;
let activeBackupPromise = null;

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function query(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.query(sql, (error, rows) => {
      if (error) return reject(error);
      resolve(rows);
    });
  });
}

function connectToDatabase() {
  const connection = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'dodomaca_sch_system',
    connectTimeout: 10000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: 'Z'
  });

  return new Promise((resolve, reject) => {
    connection.connect((error) => {
      if (error) {
        connection.destroy();
        return reject(error);
      }
      resolve(connection);
    });
  });
}

async function writeChunk(gzip, value) {
  await new Promise((resolve, reject) => {
    gzip.write(value, (error) => error ? reject(error) : resolve());
  });
}

async function acquireBackupLock() {
  ensureDir();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await fs.promises.open(BACKUP_LOCK, 'wx');
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      } finally {
        await lock.close();
      }
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      const stat = await fs.promises.stat(BACKUP_LOCK).catch((statError) => {
        if (statError.code !== 'ENOENT') throw statError;
        return null;
      });
      if (stat && Date.now() - stat.mtimeMs > STALE_LOCK_AGE_MS) {
        await fs.promises.unlink(BACKUP_LOCK).catch((unlinkError) => {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        });
        continue;
      }
      throw new Error('Another database backup is already running.');
    }
  }
  throw new Error('Could not acquire the database backup lock.');
}

async function dumpDatabase() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const backupFile = path.join(BACKUP_DIR, `backup-${ts}.sql.gz`);
  const output = fs.createWriteStream(backupFile, { flags: 'wx' });
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
  let outputCreated = false;
  output.once('open', () => { outputCreated = true; });
  gzip.pipe(output);

  const outputFinished = new Promise((resolve, reject) => {
    output.once('finish', resolve);
    output.once('error', reject);
    gzip.once('error', reject);
  });
  outputFinished.catch(() => {});

  let connection;
  let transactionStarted = false;
  try {
    connection = await connectToDatabase();
    await query(connection, 'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await query(connection, 'START TRANSACTION WITH CONSISTENT SNAPSHOT');
    transactionStarted = true;

    const tableRows = await query(connection, 'SHOW FULL TABLES');
    const objects = tableRows.map((row) => {
      const [name, type] = Object.values(row);
      return { name, type: String(type || 'BASE TABLE').toUpperCase() };
    });
    const tables = objects.filter((object) => object.type !== 'VIEW');
    const views = objects.filter((object) => object.type === 'VIEW');
    const databaseName = process.env.DB_NAME || 'school_system';

    await writeChunk(gzip, `-- Database backup: ${databaseName}\n-- Created: ${new Date().toISOString()}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`);

    for (const table of tables) {
      const tableId = mysql.escapeId(table.name);
      const createRows = await query(connection, `SHOW CREATE TABLE ${tableId}`);
      const createEntry = Object.entries(createRows[0] || {}).find(([key]) => /^Create Table$/i.test(key));
      if (!createEntry) throw new Error(`Could not read the schema for table "${table.name}".`);
      await writeChunk(gzip, `DROP TABLE IF EXISTS ${tableId};\n${createEntry[1]};\n\n`);
    }

    for (const table of tables) {
      const tableId = mysql.escapeId(table.name);
      const rowStream = connection.query(`SELECT * FROM ${tableId}`).stream({ highWaterMark: 20 });
      let columns = null;
      let columnList = null;
      let values = [];

      for await (const row of rowStream) {
        if (!columns) {
          columns = Object.keys(row);
          columnList = columns.map((column) => mysql.escapeId(column)).join(', ');
          await writeChunk(gzip, `-- Data for ${tableId}\n`);
        }

        values.push(`(${columns.map((column) => connection.escape(row[column])).join(', ')})`);
        if (values.length >= 100) {
          await writeChunk(gzip, `INSERT INTO ${tableId} (${columnList}) VALUES\n${values.join(',\n')};\n`);
          values = [];
        }
      }

      if (values.length) {
        await writeChunk(gzip, `INSERT INTO ${tableId} (${columnList}) VALUES\n${values.join(',\n')};\n`);
      }
      if (columns) await writeChunk(gzip, '\n');
    }

    for (const view of views) {
      const viewId = mysql.escapeId(view.name);
      const createRows = await query(connection, `SHOW CREATE TABLE ${viewId}`);
      const createEntry = Object.entries(createRows[0] || {}).find(([key]) => /^Create View$/i.test(key));
      if (!createEntry) throw new Error(`Could not read the definition for view "${view.name}".`);
      const definition = createEntry[1].replace(/\s+DEFINER=`[^`]*`@`[^`]*`/i, '');
      await writeChunk(gzip, `DROP VIEW IF EXISTS ${viewId};\n${definition};\n\n`);
    }

    await query(connection, 'COMMIT');
    transactionStarted = false;
    await writeChunk(gzip, '\nSET FOREIGN_KEY_CHECKS=1;\n');
    gzip.end();
    await outputFinished;
    return { backupFile, ts };
  } catch (error) {
    gzip.destroy();
    output.destroy();
    if (outputCreated) {
      await fs.promises.unlink(backupFile).catch((unlinkError) => {
        if (unlinkError.code !== 'ENOENT') console.error('Could not remove partial backup:', unlinkError.message);
      });
    }
    if (transactionStarted && connection) {
      await query(connection, 'ROLLBACK').catch((rollbackError) => {
        console.error('Could not roll back backup transaction:', rollbackError.message);
      });
    }
    throw error;
  } finally {
    if (connection) {
      await new Promise((resolve) => connection.end(() => resolve()));
    }
  }
}

async function sendBackupEmail(backupFile) {
  const recipient = process.env.BACKUP_EMAIL || process.env.MAIL_USER;
  if (!recipient) {
    return { sent: false, warning: 'No backup email recipient is configured; download the local copy instead.' };
  }

  const size = fs.statSync(backupFile).size;
  const maxBytes = (Number(process.env.BACKUP_EMAIL_MAX_MB) || 10) * 1024 * 1024;
  if (size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    return {
      sent: false,
      warning: `Email skipped because the backup exceeds the ${limitMb} MB attachment limit; download the local copy instead.`
    };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.MAIL_PORT) || 587,
    secure: false,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    tls: { rejectUnauthorized: false }
  });
  const dateStr = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const filename = path.basename(backupFile);
  const fileSize = (size / 1024).toFixed(1);

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.MAIL_USER,
    to: recipient,
    subject: `School Database Backup — ${dateStr}`,
    html: `<p>The database backup has completed.</p><p>Database: ${process.env.DB_NAME || 'school_system'}<br>File: ${filename}<br>Size: ${fileSize} KB</p>`,
    attachments: [{
      filename,
      path: backupFile,
      contentType: 'application/gzip'
    }]
  });

  console.log(`Backup email sent to ${recipient}`);
  return { sent: true };
}

function pruneOldBackups() {
  try {
    ensureDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((name) => name.startsWith('backup-') && (name.endsWith('.zip') || name.endsWith('.sql.gz')))
      .map((name) => ({ name, time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    files.slice(4).forEach((file) => {
      fs.unlinkSync(path.join(BACKUP_DIR, file.name));
      console.log(`Pruned old backup: ${file.name}`);
    });
  } catch (error) {
    console.error('Prune error:', error.message);
  }
}

async function performBackup(manual) {
  const label = manual ? 'Manual' : 'Scheduled';
  let lockAcquired = false;
  console.log(`[${new Date().toISOString()}] ${label} backup starting...`);
  try {
    await acquireBackupLock();
    lockAcquired = true;
    const { backupFile } = await dumpDatabase();
    console.log(`Database backup created: ${path.basename(backupFile)}`);

    let emailResult;
    try {
      emailResult = await sendBackupEmail(backupFile);
    } catch (emailError) {
      emailResult = {
        sent: false,
        warning: `Email delivery failed: ${emailError.message}. Download the local copy instead.`
      };
      console.error('Backup email failed:', emailError.message);
    }
    pruneOldBackups();
    console.log(`${label} backup complete.`);
    return {
      success: true,
      file: path.basename(backupFile),
      emailSent: emailResult.sent,
      warning: emailResult.warning
    };
  } catch (error) {
    console.error(`${label} backup failed:`, error.message);
    return { success: false, error: error.message };
  } finally {
    if (lockAcquired) {
      await fs.promises.unlink(BACKUP_LOCK).catch((error) => {
        if (error.code !== 'ENOENT') console.error('Could not release backup lock:', error.message);
      });
    }
  }
}

async function runBackup(manual = false) {
  if (activeBackupPromise) {
    return { success: false, error: 'A database backup is already running.' };
  }

  activeBackupPromise = performBackup(manual);
  try {
    return await activeBackupPromise;
  } finally {
    activeBackupPromise = null;
  }
}

module.exports = { runBackup, pruneOldBackups };

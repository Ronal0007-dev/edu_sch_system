'use strict';
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { Admin, Teacher } = require('../models');
const { requireAdmin, requireTeacher } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../utils/mailer');
const { checkLimit, resetLimit } = require('../utils/rateLimiter');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES       = 15;
const INACTIVITY_MS      = 5 * 60 * 1000; // 5 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';
}

function generateResetToken(email) {
  const raw   = crypto.randomBytes(32).toString('hex');
  const bound = crypto.createHmac('sha256', email.toLowerCase()).update(raw).digest('hex');
  return { raw, bound };
}

function verifyResetToken(raw, email, storedBound) {
  if (!raw || !email || !storedBound) return false;
  try {
    const expected = crypto.createHmac('sha256', email.toLowerCase()).update(raw).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(storedBound, 'hex'));
  } catch { return false; }
}

async function handleFailedLogin(account, isTeacher) {
  const attempts = (account.loginAttempts || 0) + 1;
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    await account.update({ loginAttempts: attempts, lockedUntil });
    return `Account locked for ${LOCK_MINUTES} minutes after ${MAX_LOGIN_ATTEMPTS} failed attempts.`;
  }
  await account.update({ loginAttempts: attempts, lockedUntil: null });
  return `Invalid credentials. ${MAX_LOGIN_ATTEMPTS - attempts} attempt(s) remaining before lockout.`;
}

async function handleSuccessLogin(account) {
  await account.update({ loginAttempts: 0, lockedUntil: null });
}

function isLocked(account) {
  if (!account.lockedUntil) return false;
  if (new Date() < account.lockedUntil) {
    const mins = Math.ceil((account.lockedUntil - Date.now()) / 60000);
    return `Account is locked. Try again in ${mins} minute(s).`;
  }
  return false;
}

// ─── Activity touch middleware (updates lastActive on every request) ───────────
router.use((req, res, next) => {
  if (req.session.admin || req.session.teacher) {
    const now = Date.now();
    const last = req.session.lastActive || now;
    if (now - last > INACTIVITY_MS) {
      const wasAdmin   = !!req.session.admin;
      const wasTeacher = !!req.session.teacher;
      req.session.destroy(() => {});
      if (wasAdmin)   return res.redirect('/auth/admin/login?reason=timeout');
      if (wasTeacher) return res.redirect('/auth/teacher/login?reason=timeout');
    }
    req.session.lastActive = now;
  }
  next();
});

// ─── Admin Login ───────────────────────────────────────────────────────────────
router.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  const timeout = req.query.reason === 'timeout';
  res.render('auth/admin-login', {
    title: 'Admin Login',
    error: timeout ? ['Session expired due to inactivity. Please log in again.'] : req.flash('error'),
    success: req.flash('success')
  });
});

router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ where: { username } });
    if (!admin) {
      req.flash('error', 'Invalid username or password');
      return res.redirect('/auth/admin/login');
    }
    const locked = isLocked(admin);
    if (locked) { req.flash('error', locked); return res.redirect('/auth/admin/login'); }

    if (!(await admin.validatePassword(password))) {
      const msg = await handleFailedLogin(admin, false);
      req.flash('error', msg);
      return res.redirect('/auth/admin/login');
    }
    await handleSuccessLogin(admin);
    req.session.admin      = { id: admin.id, username: admin.username };
    req.session.lastActive = Date.now();
    res.redirect('/admin/dashboard');
  } catch (err) {
    req.flash('error', 'Login error: ' + err.message);
    res.redirect('/auth/admin/login');
  }
});

// ─── Admin Change Password ─────────────────────────────────────────────────────
router.get('/admin/change-password', requireAdmin, (req, res) => {
  res.render('auth/admin-change-password', {
    title: 'Change Password', admin: req.session.admin,
    error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/admin/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');
    const admin = await Admin.findByPk(req.session.admin.id);
    if (!(await admin.validatePassword(currentPassword))) throw new Error('Current password is incorrect');
    await admin.update({ password: await bcrypt.hash(newPassword, 10) });
    req.flash('success', 'Password changed successfully');
  } catch (err) { req.flash('error', err.message); }
  res.redirect('/auth/admin/change-password');
});

// ─── Teacher Login ─────────────────────────────────────────────────────────────
router.get('/teacher/login', (req, res) => {
  if (req.session.teacher) return res.redirect('/teacher/dashboard');
  const timeout = req.query.reason === 'timeout';
  res.render('auth/teacher-login', {
    title: 'Teacher Login',
    error: timeout ? ['Session expired due to inactivity. Please log in again.'] : req.flash('error'),
    success: req.flash('success')
  });
});

router.post('/teacher/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const teacher = await Teacher.findOne({ where: { email, isActive: true }, include: ['department'] });
    if (!teacher) {
      req.flash('error', 'Invalid email or password');
      return res.redirect('/auth/teacher/login');
    }
    const locked = isLocked(teacher);
    if (locked) { req.flash('error', locked); return res.redirect('/auth/teacher/login'); }

    if (!(await teacher.validatePassword(password))) {
      const msg = await handleFailedLogin(teacher, true);
      req.flash('error', msg);
      return res.redirect('/auth/teacher/login');
    }
    await handleSuccessLogin(teacher);
    req.session.teacher    = { id: teacher.id, fullName: teacher.fullName, role: teacher.role, departmentId: teacher.departmentId };
    req.session.lastActive = Date.now();
    if (teacher.mustChangePassword) return res.redirect('/auth/teacher/first-change-password');
    res.redirect('/teacher/dashboard');
  } catch (err) {
    req.flash('error', 'Login error: ' + err.message);
    res.redirect('/auth/teacher/login');
  }
});

// ─── First-login password change ──────────────────────────────────────────────
router.get('/teacher/first-change-password', (req, res) => {
  if (!req.session.teacher) return res.redirect('/auth/teacher/login');
  res.render('auth/teacher-first-change', { title: 'Set Your Password', error: req.flash('error'), success: req.flash('success') });
});

router.post('/teacher/first-change-password', async (req, res) => {
  if (!req.session.teacher) return res.redirect('/auth/teacher/login');
  try {
    const { newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');
    await Teacher.update({ password: await bcrypt.hash(newPassword, 10), mustChangePassword: false }, { where: { id: req.session.teacher.id } });
    req.flash('success', 'Password set. Welcome!');
    res.redirect('/teacher/dashboard');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/auth/teacher/first-change-password');
  }
});

// ─── Teacher change password (logged in) ──────────────────────────────────────
router.get('/teacher/change-password', requireTeacher, (req, res) => {
  res.render('auth/teacher-change-password', { title: 'Change Password', teacher: req.session.teacher, error: req.flash('error'), success: req.flash('success') });
});

router.post('/teacher/change-password', requireTeacher, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');
    const teacher = await Teacher.findByPk(req.session.teacher.id);
    if (!(await teacher.validatePassword(currentPassword))) throw new Error('Current password is incorrect');
    await teacher.update({ password: await bcrypt.hash(newPassword, 10), mustChangePassword: false });
    req.flash('success', 'Password changed successfully');
  } catch (err) { req.flash('error', err.message); }
  res.redirect('/auth/teacher/change-password');
});

// ─── Forgot password ──────────────────────────────────────────────────────────
router.get('/teacher/forgot-password', (req, res) => {
  res.render('auth/teacher-forgot-password', { title: 'Forgot Password', error: req.flash('error'), success: req.flash('success') });
});

router.post('/teacher/forgot-password', async (req, res) => {
  const ip    = getIP(req);
  const email = (req.body.email || '').trim().toLowerCase();
  const limit = checkLimit(ip, email);
  if (!limit.allowed) {
    req.flash('error', `Too many requests. Please wait ${limit.minutes} minute(s).`);
    return res.redirect('/auth/teacher/forgot-password');
  }
  req.flash('success', 'If that email is registered, a reset link has been sent.');
  try {
    const teacher = await Teacher.findOne({ where: { email, isActive: true } });
    if (teacher) {
      const { raw, bound } = generateResetToken(teacher.email);
      await teacher.update({ resetToken: bound, resetTokenExpiry: new Date(Date.now() + 30 * 60 * 1000) });
      await sendPasswordResetEmail(teacher, raw);
    }
  } catch (err) { console.error('Forgot password error:', err.message); }
  res.redirect('/auth/teacher/forgot-password');
});

// ─── Reset password via link ──────────────────────────────────────────────────
router.get('/teacher/reset-password/:token', async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) { req.flash('error', 'Invalid reset link.'); return res.redirect('/auth/teacher/forgot-password'); }
    const teacher = await Teacher.findOne({ where: { email, isActive: true } });
    if (!teacher || !teacher.resetToken || !teacher.resetTokenExpiry) {
      req.flash('error', 'Reset link is invalid or has already been used.');
      return res.redirect('/auth/teacher/forgot-password');
    }
    if (new Date() > teacher.resetTokenExpiry) {
      await teacher.update({ resetToken: null, resetTokenExpiry: null });
      req.flash('error', 'Reset link expired (30 min). Please request a new one.');
      return res.redirect('/auth/teacher/forgot-password');
    }
    if (!verifyResetToken(req.params.token, teacher.email, teacher.resetToken)) {
      req.flash('error', 'Invalid reset link.');
      return res.redirect('/auth/teacher/forgot-password');
    }
    res.render('auth/teacher-reset-password', { title: 'Reset Password', token: req.params.token, email, error: req.flash('error'), success: req.flash('success') });
  } catch (err) { req.flash('error', 'Invalid reset link'); res.redirect('/auth/teacher/forgot-password'); }
});

router.post('/teacher/reset-password/:token', async (req, res) => {
  const ip = getIP(req);
  try {
    const { newPassword, confirmPassword, email } = req.body;
    const normalEmail = (email || '').trim().toLowerCase();
    if (!normalEmail) throw new Error('Email is required');
    if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');
    const teacher = await Teacher.findOne({ where: { email: normalEmail, isActive: true } });
    if (!teacher || !teacher.resetToken || !teacher.resetTokenExpiry) throw new Error('Reset link is invalid or already used');
    if (new Date() > teacher.resetTokenExpiry) {
      await teacher.update({ resetToken: null, resetTokenExpiry: null });
      throw new Error('Reset link expired. Please request a new one.');
    }
    if (!verifyResetToken(req.params.token, teacher.email, teacher.resetToken)) throw new Error('Invalid reset link');
    await teacher.update({ password: await bcrypt.hash(newPassword, 10), mustChangePassword: false, resetToken: null, resetTokenExpiry: null, loginAttempts: 0, lockedUntil: null });
    resetLimit(ip, normalEmail);
    req.flash('success', 'Password reset successfully. You can now log in.');
    res.redirect('/auth/teacher/login');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect(`/auth/teacher/reset-password/${req.params.token}?email=${encodeURIComponent(req.body.email || '')}`);
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Admin, Teacher } = require('../models');
const { requireAdmin, requireTeacher } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../utils/mailer');

// ── Admin Login ────────────────────────────────────────────────────────────────
router.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  res.render('auth/admin-login', { title: 'Admin Login', error: req.flash('error'), success: req.flash('success') });
});

router.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ where: { username } });
    if (!admin || !(await admin.validatePassword(password))) {
      req.flash('error', 'Invalid username or password');
      return res.redirect('/auth/admin/login');
    }
    req.session.admin = { id: admin.id, username: admin.username };
    res.redirect('/admin/dashboard');
  } catch (err) {
    req.flash('error', 'Login failed: ' + err.message);
    res.redirect('/auth/admin/login');
  }
});

// ── Admin Change Password ──────────────────────────────────────────────────────
router.get('/admin/change-password', requireAdmin, (req, res) => {
  res.render('auth/admin-change-password', {
    title: 'Change Password',
    admin: req.session.admin,
    error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/admin/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) throw new Error('New passwords do not match');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');

    const admin = await Admin.findByPk(req.session.admin.id);
    if (!(await admin.validatePassword(currentPassword))) throw new Error('Current password is incorrect');

    const hash = await bcrypt.hash(newPassword, 10);
    await admin.update({ password: hash });
    req.flash('success', 'Password changed successfully');
    res.redirect('/admin/change-password');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/auth/admin/change-password');
  }
});

// ── Teacher Login ──────────────────────────────────────────────────────────────
router.get('/teacher/login', (req, res) => {
  if (req.session.teacher) return res.redirect('/teacher/dashboard');
  res.render('auth/teacher-login', { title: 'Teacher Login', error: req.flash('error'), success: req.flash('success') });
});

router.post('/teacher/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const teacher = await Teacher.findOne({ where: { email, isActive: true }, include: ['department'] });
    if (!teacher || !(await teacher.validatePassword(password))) {
      req.flash('error', 'Invalid email or password');
      return res.redirect('/auth/teacher/login');
    }
    req.session.teacher = { id: teacher.id, fullName: teacher.fullName, role: teacher.role, departmentId: teacher.departmentId };

    // Force password change on first login
    if (teacher.mustChangePassword) {
      return res.redirect('/auth/teacher/first-change-password');
    }
    res.redirect('/teacher/dashboard');
  } catch (err) {
    req.flash('error', 'Login failed: ' + err.message);
    res.redirect('/auth/teacher/login');
  }
});

// ── Teacher First-Login: Force Password Change ────────────────────────────────
router.get('/teacher/first-change-password', (req, res) => {
  if (!req.session.teacher) return res.redirect('/auth/teacher/login');
  res.render('auth/teacher-first-change', {
    title: 'Set Your Password',
    error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/teacher/first-change-password', async (req, res) => {
  if (!req.session.teacher) return res.redirect('/auth/teacher/login');
  try {
    const { newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');

    const hash = await bcrypt.hash(newPassword, 10);
    await Teacher.update(
      { password: hash, mustChangePassword: false },
      { where: { id: req.session.teacher.id } }
    );
    req.flash('success', 'Password set successfully. Welcome!');
    res.redirect('/teacher/dashboard');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/auth/teacher/first-change-password');
  }
});

// ── Teacher Change Password (when logged in) ──────────────────────────────────
router.get('/teacher/change-password', requireTeacher, (req, res) => {
  res.render('auth/teacher-change-password', {
    title: 'Change Password',
    teacher: req.session.teacher,
    error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/teacher/change-password', requireTeacher, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) throw new Error('New passwords do not match');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');

    const teacher = await Teacher.findByPk(req.session.teacher.id);
    if (!(await teacher.validatePassword(currentPassword))) throw new Error('Current password is incorrect');

    const hash = await bcrypt.hash(newPassword, 10);
    await teacher.update({ password: hash, mustChangePassword: false });
    req.flash('success', 'Password changed successfully');
    res.redirect('/auth/teacher/change-password');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/auth/teacher/change-password');
  }
});

// ── Forgot Password (teacher request form) ────────────────────────────────────
router.get('/teacher/forgot-password', (req, res) => {
  res.render('auth/teacher-forgot-password', {
    title: 'Forgot Password',
    error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/teacher/forgot-password', async (req, res) => {
  // Always show success to prevent email enumeration
  req.flash('success', 'If that email is registered, a reset link has been sent.');
  try {
    const { email } = req.body;
    const teacher = await Teacher.findOne({ where: { email, isActive: true } });
    if (teacher) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await teacher.update({ resetToken: token, resetTokenExpiry: expiry });
      await sendPasswordResetEmail(teacher, token);
    }
  } catch (err) {
    console.error('Forgot password error:', err.message);
  }
  res.redirect('/auth/teacher/forgot-password');
});

// ── Reset Password via token ───────────────────────────────────────────────────
router.get('/teacher/reset-password/:token', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({
      where: { resetToken: req.params.token }
    });
    if (!teacher || !teacher.resetTokenExpiry || new Date() > teacher.resetTokenExpiry) {
      req.flash('error', 'Reset link is invalid or has expired. Please request a new one.');
      return res.redirect('/auth/teacher/forgot-password');
    }
    res.render('auth/teacher-reset-password', {
      title: 'Reset Password',
      token: req.params.token,
      error: req.flash('error'), success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', 'Invalid reset link');
    res.redirect('/auth/teacher/forgot-password');
  }
});

router.post('/teacher/reset-password/:token', async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) throw new Error('Passwords do not match');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');

    const teacher = await Teacher.findOne({ where: { resetToken: req.params.token } });
    if (!teacher || !teacher.resetTokenExpiry || new Date() > teacher.resetTokenExpiry) {
      throw new Error('Reset link is invalid or has expired');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await teacher.update({
      password: hash,
      mustChangePassword: false,
      resetToken: null,
      resetTokenExpiry: null
    });
    req.flash('success', 'Password reset successfully. You can now log in.');
    res.redirect('/auth/teacher/login');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect(`/auth/teacher/reset-password/${req.params.token}`);
  }
});

// ── Logout ─────────────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;

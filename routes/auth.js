const express = require('express');
const router = express.Router();
const { Admin, Teacher } = require('../models');

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
    res.redirect('/teacher/dashboard');
  } catch (err) {
    req.flash('error', 'Login failed: ' + err.message);
    res.redirect('/auth/teacher/login');
  }
});

// ── Logout ─────────────────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;

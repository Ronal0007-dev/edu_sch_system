const express = require('express');
const router = express.Router();
const { Teacher, Department, Timetable, Subject, Class } = require('../models');

// Middleware to ensure user is logged in as an academician (or admin)
function requireAcademician(req, res, next) {
  if (req.session.teacher && (req.session.teacher.role === 'academician' || req.session.teacher.role === 'admin')) {
    return next();
  }
  if (req.session.admin) {
    return next(); // Admins can also view this portal
  }
  req.flash('error', 'Unauthorized access.');
  return res.redirect('/');
}

router.use(requireAcademician);

// ── View All Teachers List ────────────────────────────────────────────────────
router.get('/teachers', async (req, res) => {
  try {
    const teachers = await Teacher.findAll({
      include: [{ model: Department, as: 'department' }],
      order: [['fullName', 'ASC']]
    });
    
    res.render('academician/teachers-list', {
      title: 'Teachers Directory',
      teachers: teachers.map(t => t.toJSON()),
      user: req.session.teacher || req.session.admin,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/teacher/dashboard');
  }
});

// ── View Specific Teacher Profile & Timetable ──────────────────────────────────
router.get('/teachers/view/:id', async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id, {
      include: [{ model: Department, as: 'department' }]
    });
    
    if (!teacher) {
      req.flash('error', 'Teacher not found');
      return res.redirect('/academician/teachers');
    }

    // Get current term/year parameters or defaults
    const term = req.query.term || 'Term 1';
    const year = req.query.year || '2024/2025';

    const timetables = await Timetable.findAll({
      where: { teacherId: teacher.id, term, academicYear: year },
      include: [{
        model: Subject,
        as: 'subject',
        include: [{ model: Class, as: 'class' }]
      }],
      order: [['day', 'ASC'], ['startTime', 'ASC']]
    });

    res.render('academician/teacher-profile', {
      title: `Profile: ${teacher.fullName}`,
      teacher: teacher.toJSON(),
      timetables: timetables.map(t => t.toJSON()),
      term,
      year,
      user: req.session.teacher || req.session.admin,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/academician/teachers');
  }
});

module.exports = router;
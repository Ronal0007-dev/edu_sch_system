const express = require('express');
const router = express.Router();
const {
  Teacher,
  Department,
  Timetable,
  SubstituteRequest,
  Subject,
  Class,
  TeacherSubject
} = require('../models');

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
      include: [{
        model: Department,
        as: 'department'
      }],
      order: [
        ['fullName', 'ASC']
      ]
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
      include: [{
        model: Department,
        as: 'department'
      }]
    });

    if (!teacher) {
      req.flash('error', 'Teacher not found');
      return res.redirect('/academician/teachers');
    }

    // Get current term/year parameters or defaults
    const term = req.query.term || 'Term 1';
    const year = req.query.year || '2024/2025';

    const timetables = await Timetable.findAll({
      where: {
        teacherId: teacher.id,
        term,
        academicYear: year
      },
      include: [{
        model: Subject,
        as: 'subject',
        include: [{
          model: Class,
          as: 'class'
        }]
      }],
      order: [
        ['day', 'ASC'],
        ['startTime', 'ASC']
      ]
    });

    const teacherSubjects = await TeacherSubject.findAll({
      where: {
        teacherId: teacher.id
      },
      include: [{
          model: Subject,
          as: 'subject'
        },
        {
          model: Class,
          as: 'class'
        }
      ],
      order: [
        ['id', 'ASC']
      ]
    });
    if (req.session.teacher && req.session.teacher.role !== 'admin' &&
      String(teacher.departmentId) !== String(req.session.teacher.departmentId)) {
      req.flash('error', 'You may only view teachers in your department.');
      return res.redirect('/academician/teachers');
    }
    const timetableDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const timetableSlots = [{
        label: '08:05 - 08:50',
        start: '08:05'
      },
      {
        label: '08:55 - 09:40',
        start: '08:55'
      },
      {
        label: '09:45 - 10:30',
        start: '09:45'
      },
      {
        label: 'BREAK',
        break: true,
        note: '10:30 - 11:00'
      },
      {
        label: '11:00 - 11:45',
        start: '11:00'
      },
      {
        label: '11:45 - 12:30',
        start: '11:45'
      },
      {
        label: 'BREAK',
        break: true,
        note: '12:30 - 13:15'
      },
      {
        label: '13:15 - 14:00',
        start: '13:15'
      },
      {
        label: '14:05 - 14:50',
        start: '14:05'
      },
    ];
    const substituteRequests = await SubstituteRequest.findAll({
      include: [{
          model: Teacher,
          as: 'requester'
        },
        {
          model: Teacher,
          as: 'substitute'
        },
        {
          model: Timetable,
          as: 'timetable',
          include: [{
            model: Subject,
            as: 'subject',
            include: [{
              model: Class,
              as: 'class'
            }]
          }]
        },
      ],
      order: [
        ['createdAt', 'DESC']
      ],
    });
    const departmentRequests = req.session.teacher && req.session.teacher.role === 'admin' ?
      substituteRequests :
      substituteRequests.filter((request) =>
        request.requester && String(request.requester.departmentId) === String(req.session.teacher.departmentId) &&
        request.substitute && String(request.substitute.departmentId) === String(req.session.teacher.departmentId)
      );

    res.render('academician/teacher-profile', {
      title: `Profile: ${teacher.fullName}`,
      teacher: teacher.toJSON(),
      teacherSubjects: teacherSubjects.map(ts => ts.toJSON()),
      timetables: timetables.map(t => t.toJSON()),
      timetableDays,
      timetableSlots,
      substituteRequests: departmentRequests,
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
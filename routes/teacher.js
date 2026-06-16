const express = require('express');
const router = express.Router();
const moment = require('moment');
const { Op } = require('sequelize');
const { requireTeacher } = require('../middleware/auth');
const { calculateScore, getGrade, getRemark } = require('../utils/grading');
const {
  AcademicYear, Term, Teacher, Class, Student, Stream, Subject,
  Attendance, Mark, TeacherClass, TeacherSubject, PublicHoliday
} = require('../models');

router.use(requireTeacher);

// ── Helper: current year ───────────────────────────────────────────────────────
async function getCurrentYear() {
  return AcademicYear.findOne({ where: { isCurrent: true }, include: ['terms'] });
}

// ── Helper: school day count between two dates ─────────────────────────────────
async function countSchoolDays(startDate, endDate) {
  const holidays = await require('../models').PublicHoliday.findAll();
  const holidayDates = new Set(holidays.map(h => h.date));
  let count = 0;
  let d = moment(startDate);
  const end = moment(endDate);
  while (d.isSameOrBefore(end, 'day')) {
    const dow = d.day();
    if (dow !== 0 && dow !== 6 && !holidayDates.has(d.format('YYYY-MM-DD'))) count++;
    d.add(1, 'day');
  }
  return count;
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const teacher = await Teacher.findByPk(req.session.teacher.id, { include: ['department'] });
    const teacherClassRows = await TeacherClass.findAll({
      where: { teacherId: req.session.teacher.id },
      include: [{ model: Class, as: 'class', include: ['department', 'students'] }]
    });
    const assignedClasses = teacherClassRows.map(tc => tc.class).filter(Boolean);
    const teacherSubjectRows = await TeacherSubject.findAll({
      where: { teacherId: req.session.teacher.id },
      include: [{ model: Subject, as: 'subject' }, { model: Class, as: 'class' }]
    });

    const today = moment().format('YYYY-MM-DD');
    const dayOfWeek = moment().day();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const holiday = await PublicHoliday.findOne({ where: { date: today } });
    const canTakeAttendance = !isWeekend && !holiday;
    const currentYear = await getCurrentYear();

    const recentAttendance = await Attendance.findAll({
      where: { takenBy: req.session.teacher.id },
      limit: 10, order: [['date', 'DESC']], include: ['student', 'class']
    });

    res.render('teacher/dashboard', {
      title: 'Teacher Dashboard',
      teacher: { ...teacher.toJSON(), classes: assignedClasses, teacherSubjects: teacherSubjectRows },
      today, canTakeAttendance, isWeekend, holiday, recentAttendance, currentYear,
      error: req.flash('error'), success: req.flash('success')
    });
  } catch (err) {
    res.render('teacher/dashboard', {
      title: 'Teacher Dashboard', teacher: null, today: '', canTakeAttendance: false,
      isWeekend: false, holiday: null, recentAttendance: [], currentYear: null,
      error: [err.message], success: []
    });
  }
});

// ── Attendance ─────────────────────────────────────────────────────────────────
router.get('/attendance', async (req, res) => {
  const teacherClassRows = await TeacherClass.findAll({
    where: { teacherId: req.session.teacher.id },
    include: [{ model: Class, as: 'class', include: ['department'] }]
  });
  const classes = teacherClassRows.map(tc => tc.class).filter(Boolean);

  let students = [], selectedClass = null;
  const today = moment().format('YYYY-MM-DD');
  let canTakeAttendance = true, blockReason = '';
  const dayOfWeek = moment().day();
  if (dayOfWeek === 0 || dayOfWeek === 6) { canTakeAttendance = false; blockReason = 'Attendance is not taken on weekends'; }
  const holiday = await PublicHoliday.findOne({ where: { date: today } });
  if (holiday) { canTakeAttendance = false; blockReason = `Today is a public holiday: ${holiday.name}`; }

  if (req.query.classId) {
    selectedClass = await Class.findByPk(req.query.classId);
    const rawStudents = await Student.findAll({ where: { classId: req.query.classId, isActive: true }, include: ['stream'], order: [['fullName', 'ASC']] });
    const existingAttendance = await Attendance.findAll({ where: { classId: req.query.classId, date: today } });
    students = rawStudents.map(s => ({
      ...s.toJSON(),
      existingStatus: (existingAttendance.find(a => a.studentId === s.id) || {}).status || null,
    }));
  }

  res.render('teacher/attendance', {
    title: 'Take Attendance', classes, students, selectedClass, today, canTakeAttendance, blockReason,
    teacher: req.session.teacher, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/attendance/submit', async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    if ([0, 6].includes(moment().day())) throw new Error('Cannot take attendance on weekends');
    const holiday = await PublicHoliday.findOne({ where: { date: today } });
    if (holiday) throw new Error(`Cannot take attendance on ${holiday.name}`);
    const { classId } = req.body;
    const students = await Student.findAll({ where: { classId, isActive: true } });
    for (const student of students) {
      const status = req.body[`status_${student.id}`];
      if (status) {
        await Attendance.upsert({ studentId: student.id, classId, date: today, status, takenBy: req.session.teacher.id });
      }
    }
    req.flash('success', 'Attendance saved successfully');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect(`/teacher/attendance?classId=${req.body.classId}`);
});

// ── Print Attendance ───────────────────────────────────────────────────────────
router.get('/attendance/print', async (req, res) => {
  try {
    const { classId, date } = req.query;
    const cls = await Class.findByPk(classId, { include: ['department'] });
    const students = await Student.findAll({ where: { classId, isActive: true }, order: [['fullName', 'ASC']] });
    let records = [];
    if (date) {
      records = await Attendance.findAll({ where: { classId, date }, include: ['student'] });
    }
    const summary = students.map(s => {
      const rec = records.find(r => r.studentId === s.id);
      return { student: s, status: rec ? rec.status : 'not recorded' };
    });
    res.render('teacher/print-attendance', { title: 'Print Attendance', cls, summary, date: date || moment().format('YYYY-MM-DD'), teacher: req.session.teacher });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/teacher/attendance');
  }
});

// ── Attendance History ─────────────────────────────────────────────────────────
router.get('/attendance/history', async (req, res) => {
  const teacherClassRows = await TeacherClass.findAll({
    where: { teacherId: req.session.teacher.id },
    include: [{ model: Class, as: 'class' }]
  });
  const classes = teacherClassRows.map(tc => tc.class).filter(Boolean);
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  let records = [], total = 0;

  if (req.query.classId && req.query.date) {
    const { count, rows } = await Attendance.findAndCountAll({
      where: { classId: req.query.classId, date: req.query.date },
      include: ['student'], order: [[{ model: Student, as: 'student' }, 'fullName', 'ASC']],
      limit, offset: (page - 1) * limit
    });
    records = rows; total = count;
  }

  res.render('teacher/attendance-history', {
    title: 'Attendance History', classes, records, teacher: req.session.teacher, query: req.query,
    pagination: { page, pages: Math.ceil(total / limit), total },
    error: req.flash('error'), success: req.flash('success')
  });
});

// ── Marks ──────────────────────────────────────────────────────────────────────
router.get('/marks', async (req, res) => {
  const currentYear = await getCurrentYear();
  const teacherSubjectRows = await TeacherSubject.findAll({
    where: { teacherId: req.session.teacher.id },
    include: [
      { model: Subject, as: 'subject' },
      { model: Class, as: 'class', include: ['department'] }
    ]
  });

  // Build unique subjects list (deduped by subject id) for first select
  const subjectMap = new Map();
  teacherSubjectRows.forEach(ts => {
    if (ts.subject && !subjectMap.has(ts.subject.id)) {
      subjectMap.set(ts.subject.id, ts.subject);
    }
  });
  const uniqueSubjects = [...subjectMap.values()];

  // Build unique classes list filtered by selected subject
  const selectedSubjectId = req.query.subjectId;
  const classesForSubject = selectedSubjectId
    ? teacherSubjectRows.filter(ts => ts.subject && ts.subject.id == selectedSubjectId).map(ts => ts.class).filter(Boolean)
    : [];

  // Deduplicate classes
  const classMap = new Map();
  classesForSubject.forEach(c => { if (c) classMap.set(c.id, c); });
  const uniqueClasses = [...classMap.values()];

  const term = req.query.term || (currentYear && currentYear.terms && currentYear.terms[0] ? currentYear.terms[0].name : 'Term 1');
  const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');

  let students = [], selectedSubject = null, selectedClass = null, existingMarks = {};

  if (req.query.subjectId && req.query.classId) {
    selectedSubject = await Subject.findByPk(req.query.subjectId);
    selectedClass = await Class.findByPk(req.query.classId);
    students = await Student.findAll({
      where: { classId: req.query.classId, isActive: true },
      include: ['stream'], order: [['fullName', 'ASC']]
    });
    const marks = await Mark.findAll({ where: { subjectId: req.query.subjectId, classId: req.query.classId, term, academicYear: year } });
    marks.forEach(m => { existingMarks[m.studentId] = m; });
  }

  res.render('teacher/marks', {
    title: 'Enter Marks',
    teacherSubjectRows, uniqueSubjects, uniqueClasses,
    students, selectedSubject, selectedClass, existingMarks,
    term, year, currentYear,
    teacher: req.session.teacher,
    error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/marks/save', async (req, res) => {
  try {
    const { classId, subjectId, term, academicYear } = req.body;
    const studentIds = Object.keys(req.body).filter(k => k.startsWith('hw_')).map(k => k.replace('hw_', ''));
    for (const studentId of studentIds) {
      const homework = parseFloat(req.body[`hw_${studentId}`]) || 0;
      const groupWork = parseFloat(req.body[`gw_${studentId}`]) || 0;
      const quiz = parseFloat(req.body[`qz_${studentId}`]) || 0;
      const classWork = parseFloat(req.body[`cw_${studentId}`]) || 0;
      const unitTest = parseFloat(req.body[`ut_${studentId}`]) || 0;
      const finalExam = parseFloat(req.body[`fe_${studentId}`]) || 0;
      const method = req.body[`method_${studentId}`] || 'weighted';
      const totalScore = calculateScore({ homework, classWork, groupWork, quiz, unitTest, finalExam }, method);
      const grade = getGrade(totalScore);
      await Mark.upsert({ studentId, subjectId, classId, term, academicYear, homework, groupWork, quiz, classWork, unitTest, finalExam, gradingMethod: method, totalScore, grade, enteredBy: req.session.teacher.id });
    }
    req.flash('success', 'Marks saved successfully');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect(`/teacher/marks?subjectId=${req.body.subjectId}&classId=${req.body.classId}&term=${req.body.term}&year=${req.body.academicYear}`);
});

// ── Report Card (single student) ──────────────────────────────────────────────
router.get('/report-card/:studentId', async (req, res) => {
  try {
    const currentYear = await getCurrentYear();
    const student = await Student.findByPk(req.params.studentId, { include: ['class', 'stream'] });
    const term = req.query.term || (currentYear && currentYear.terms && currentYear.terms[0] ? currentYear.terms[0].name : 'Term 1');
    const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');
    const marks = await Mark.findAll({ where: { studentId: req.params.studentId, term, academicYear: year }, include: ['subject'] });
    const attendance = await Attendance.findAll({ where: { studentId: req.params.studentId } });
    const presentDays = attendance.filter(a => a.status === 'present').length;
    const totalDays = attendance.length;
    const academicYears = await AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] });
    res.render('teacher/report-card', {
      title: 'Student Report Card', student, marks, term, year, presentDays, totalDays,
      getRemark, currentYear, academicYears, teacher: req.session.teacher,
      error: req.flash('error'), success: req.flash('success')
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/teacher/marks');
  }
});

// ── Report Cards List ──────────────────────────────────────────────────────────
router.get('/report-cards', async (req, res) => {
  const currentYear = await getCurrentYear();
  const teacherClassRows = await TeacherClass.findAll({
    where: { teacherId: req.session.teacher.id },
    include: [{ model: Class, as: 'class', include: ['students'] }]
  });
  const classes = teacherClassRows.map(tc => tc.class).filter(Boolean);
  const academicYears = await AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] });
  res.render('teacher/report-cards', {
    title: 'Report Cards', classes, currentYear, academicYears,
    teacher: req.session.teacher, error: req.flash('error'), success: req.flash('success')
  });
});

module.exports = router;

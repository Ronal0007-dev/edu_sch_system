const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const moment = require('moment');
const { Op } = require('sequelize');
const { requireAdmin } = require('../middleware/auth');
const { getRemark, getPrimaryExamGrade, primaryExamPassed, secondaryExamPassed, buildExamAnalysis } = require('../utils/grading');
const { sendPasswordResetEmail } = require('../utils/mailer');
const crypto = require('crypto');
const {
  AcademicYear, Term, Department, Teacher, Class, Stream, Subject, Student,
  TeacherClass, TeacherSubject, ClassSubject, Attendance, Mark, PublicHoliday,
  ReportComment
} = require('../models');

router.use(requireAdmin);

// ── Safe flash helper ─────────────────────────────────────────────────────────
function flash(req, type) {
  try { return req.flash(type) || []; } catch(e) { return []; }
}

// ── Helper: get current academic year ─────────────────────────────────────────
async function getCurrentYear() {
  return AcademicYear.findOne({ where: { isCurrent: true }, include: ['terms'] });
}

// ── Helper: paginate ───────────────────────────────────────────────────────────
function paginate(query, page, limit = 15) {
  const p = parseInt(page) || 1;
  return { ...query, limit, offset: (p - 1) * limit };
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  // Safe defaults — always defined so the view never crashes
  const defaults = {
    title: 'Admin Dashboard',
    totalStudents: 0, totalTeachers: 0, totalClasses: 0, totalDepts: 0,
    classes: [], attendanceData: [], currentYear: null, academicYears: [],
    admin: req.session && req.session.admin ? req.session.admin : {},
    error: [], success: []
  };

  try {
    const currentYear = await getCurrentYear();

    const [totalStudents, totalTeachers, totalClasses, totalDepts, classes, academicYears] = await Promise.all([
      Student.count({ where: { isActive: true } }),
      Teacher.count({ where: { isActive: true } }),
      Class.count(),
      Department.count(),
      Class.findAll({ include: ['department', 'students'] }),
      AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] })
    ]);

    // Build student enrollment per class for pie chart
    const attendanceData = classes.map(cls => ({
      name: cls.name,
      total: cls.students ? cls.students.length : 0
    }));

    // Safe flash read
    let flashError = [], flashSuccess = [];
    try { flashError = req.flash('error') || []; } catch(e) {}
    try { flashSuccess = req.flash('success') || []; } catch(e) {}

    res.render('admin/dashboard', {
      ...defaults,
      totalStudents, totalTeachers, totalClasses, totalDepts,
      classes, attendanceData, currentYear, academicYears,
      admin: req.session.admin,
      error: flashError, success: flashSuccess
    });
  } catch (err) {
    console.error('Dashboard error:', err.message);
    let flashError = [err.message];
    try { flashError = [err.message, ...(req.flash('error') || [])]; } catch(e) {}
    res.render('admin/dashboard', { ...defaults, error: flashError });
  }
});

// ── Academic Years ────────────────────────────────────────────────────────────
router.get('/academic-years', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const { count, rows: years } = await AcademicYear.findAndCountAll({
    include: ['terms'], order: [['startDate', 'DESC']],
    limit, offset: (page - 1) * limit
  });
  res.render('admin/academic-years', {
    title: 'Academic Years', years,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/academic-years', async (req, res) => {
  try {
    const { name, startDate, endDate, isCurrent } = req.body;
    if (isCurrent) await AcademicYear.update({ isCurrent: false }, { where: {} });
    await AcademicYear.create({ name, startDate, endDate, isCurrent: !!isCurrent });
    req.flash('success', 'Academic year created');
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
  }
  res.redirect('/admin/academic-years');
});

router.post('/academic-years/:id/set-current', async (req, res) => {
  try {
    await AcademicYear.update({ isCurrent: false }, { where: {} });
    await AcademicYear.update({ isCurrent: true }, { where: { id: req.params.id } });
    req.flash('success', 'Current academic year updated');
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
  }
  res.redirect('/admin/academic-years');
});

router.post('/academic-years/:id/delete', async (req, res) => {
  try {
    await AcademicYear.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Academic year deleted');
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
  }
  res.redirect('/admin/academic-years');
});

// ── Terms ─────────────────────────────────────────────────────────────────────
router.post('/terms', async (req, res) => {
  try {
    const { academicYearId, name, startDate, endDate } = req.body;
    await Term.create({ academicYearId, name, startDate, endDate, isOpen: true });
    req.flash('success', 'Term added');
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
  }
  res.redirect('/admin/academic-years');
});

router.post('/terms/:id/toggle', async (req, res) => {
  try {
    const term = await Term.findByPk(req.params.id);
    await term.update({ isOpen: !term.isOpen });
    req.flash('success', `Term ${term.isOpen ? 'opened' : 'closed'}`);
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
  }
  res.redirect('/admin/academic-years');
});

router.post('/terms/:id/delete', async (req, res) => {
  try {
    await Term.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Term deleted');
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
  }
  res.redirect('/admin/academic-years');
});

// ── Departments ────────────────────────────────────────────────────────────────
router.get('/departments', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const { count, rows: departments } = await Department.findAndCountAll({
    include: ['classes', 'teachers'], limit, offset: (page - 1) * limit
  });
  res.render('admin/departments', {
    title: 'Departments', departments,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/departments', async (req, res) => {
  try {
    await Department.create({ name: req.body.name, code: req.body.code });
    req.flash('success', 'Department created');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/departments');
});

router.post('/departments/:id/delete', async (req, res) => {
  try {
    await Department.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Department deleted');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/departments');
});

// ── Teachers ───────────────────────────────────────────────────────────────────
router.get('/teachers', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const [{ count, rows: teachers }, departments] = await Promise.all([
    Teacher.findAndCountAll({ include: ['department'], limit, offset: (page - 1) * limit, order: [['fullName', 'ASC']] }),
    Department.findAll()
  ]);
  res.render('admin/teachers', {
    title: 'Teachers', teachers, departments,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/teachers', async (req, res) => {
  try {
    const { fullName, phone, email, departmentId } = req.body;
    const dept = await Department.findByPk(departmentId);
    const defaultPassword = `${phone}${dept ? dept.code : departmentId}`;
    const hash = await bcrypt.hash(defaultPassword, 10);
    await Teacher.create({ fullName, phone, email, password: hash, departmentId });
    req.flash('success', `Teacher created. Default password: ${defaultPassword}`);
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/teachers');
});

router.post('/teachers/:id/role', async (req, res) => {
  try {
    await Teacher.update({ role: req.body.role }, { where: { id: req.params.id } });
    req.flash('success', 'Role updated');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/teachers');
});

router.post('/teachers/:id/revoke-role', async (req, res) => {
  try {
    await Teacher.update({ role: 'teacher' }, { where: { id: req.params.id } });
    req.flash('success', 'Role revoked');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/teachers');
});

router.post('/teachers/:id/toggle', async (req, res) => {
  try {
    const teacher = await Teacher.findByPk(req.params.id);
    await teacher.update({ isActive: !teacher.isActive });
    req.flash('success', `Teacher ${teacher.isActive ? 'activated' : 'deactivated'}`);
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/teachers');
});

// ── Classes ────────────────────────────────────────────────────────────────────
router.get('/classes', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const [{ count, rows: classes }, departments] = await Promise.all([
    Class.findAndCountAll({ include: ['department', 'streams', 'students'], limit, offset: (page - 1) * limit }),
    Department.findAll()
  ]);
  res.render('admin/classes', {
    title: 'Classes', classes, departments,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/classes', async (req, res) => {
  try {
    await Class.create({ name: req.body.name, departmentId: req.body.departmentId });
    req.flash('success', 'Class created');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/classes');
});

router.post('/classes/:id/delete', async (req, res) => {
  try {
    await Class.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Class deleted');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/classes');
});

// ── Streams ────────────────────────────────────────────────────────────────────
router.get('/streams', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const [{ count, rows: streams }, classes] = await Promise.all([
    Stream.findAndCountAll({ include: ['class'], limit, offset: (page - 1) * limit }),
    Class.findAll({ include: ['department'] })
  ]);
  res.render('admin/streams', {
    title: 'Streams', streams, classes,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/streams', async (req, res) => {
  try {
    await Stream.create({ name: req.body.name, classId: req.body.classId });
    req.flash('success', 'Stream created');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/streams');
});

router.post('/streams/:id/delete', async (req, res) => {
  try {
    await Stream.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Stream deleted');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/streams');
});

// ── Subjects ───────────────────────────────────────────────────────────────────
router.get('/subjects', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const departments = await Department.findAll({ order: [['name', 'ASC']] });

  // Filter by dept → class cascade
  const selectedDeptId = req.query.deptId || '';
  const selectedClassId = req.query.classId || '';

  let classes = [];
  if (selectedDeptId) {
    classes = await Class.findAll({ where: { departmentId: selectedDeptId }, include: ['department'] });
  }

  // Build subject query with optional class filter
  const subjectWhere = {};
  if (selectedClassId) subjectWhere.classId = selectedClassId;
  else if (selectedDeptId && classes.length) {
    subjectWhere.classId = classes.map(c => c.id);
  }

  const { count, rows: subjects } = await Subject.findAndCountAll({
    where: Object.keys(subjectWhere).length ? subjectWhere : {},
    include: [{ model: Class, as: 'class', include: ['department'] }],
    order: [['name', 'ASC']],
    limit, offset: (page - 1) * limit
  });

  // For the form: all classes if no dept selected, filtered if dept selected
  const allClasses = await Class.findAll({ include: ['department'], order: [['name', 'ASC']] });

  // Build dept→classes map for cascade JS
  const deptClassMap = {};
  allClasses.forEach(c => {
    const did = c.departmentId;
    if (!deptClassMap[did]) deptClassMap[did] = [];
    deptClassMap[did].push({ id: c.id, name: c.name });
  });

  res.render('admin/subjects', {
    title: 'Subjects', subjects, departments, classes, allClasses, deptClassMap,
    selectedDeptId, selectedClassId,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/subjects', async (req, res) => {
  try {
    await Subject.create({ name: req.body.name, classId: req.body.classId });
    req.flash('success', 'Subject created');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/subjects');
});

router.post('/subjects/:id/delete', async (req, res) => {
  try {
    await Subject.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Subject deleted');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/subjects');
});

// ── Students ───────────────────────────────────────────────────────────────────
router.get('/students', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const [departments, allClasses, allStreams] = await Promise.all([
    Department.findAll({ order: [['name', 'ASC']] }),
    Class.findAll({ include: ['department'], order: [['name', 'ASC']] }),
    Stream.findAll({ include: ['class'] })
  ]);

  // Build cascade maps
  const deptClassMap = {};
  allClasses.forEach(c => {
    const did = c.departmentId;
    if (!deptClassMap[did]) deptClassMap[did] = [];
    deptClassMap[did].push({ id: c.id, name: c.name });
  });
  const classStreamMap = {};
  allStreams.forEach(s => {
    if (!classStreamMap[s.classId]) classStreamMap[s.classId] = [];
    classStreamMap[s.classId].push({ id: s.id, name: s.name });
  });

  const { count, rows: students } = await Student.findAndCountAll({
    where: { isActive: true },
    include: ['class', 'stream'],
    order: [['fullName', 'ASC']],
    limit, offset: (page - 1) * limit
  });

  res.render('admin/students', {
    title: 'Students', students,
    departments, allClasses, allStreams, deptClassMap, classStreamMap,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/students', async (req, res) => {
  try {
    const { fullName, gender, classId, streamId } = req.body;
    await Student.create({ fullName, gender, classId, streamId: streamId || null });
    req.flash('success', 'Student added');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/students');
});

router.post('/students/:id/delete', async (req, res) => {
  try {
    await Student.update({ isActive: false }, { where: { id: req.params.id } });
    req.flash('success', 'Student removed');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/students');
});

// ── Assign Teachers to Classes ─────────────────────────────────────────────────
router.get('/assignments/teacher-class', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const [teachers, classes, { count, rows: assignments }] = await Promise.all([
    Teacher.findAll({ where: { isActive: true }, include: ['department'] }),
    Class.findAll({ include: ['department'] }),
    TeacherClass.findAndCountAll({ include: [{ model: Teacher, as: 'teacher' }, { model: Class, as: 'class' }], limit, offset: (page - 1) * limit })
  ]);
  res.render('admin/assign-teacher-class', {
    title: 'Assign Teachers to Classes', teachers, classes, assignments,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/assignments/teacher-class', async (req, res) => {
  try {
    const { teacherId, classIds, classTeacherId } = req.body;
    const ids = Array.isArray(classIds) ? classIds : [classIds];
    for (const classId of ids) {
      const [row] = await TeacherClass.findOrCreate({ where: { teacherId, classId } });
      const isClassTeacher = classTeacherId === classId;
      if (isClassTeacher) {
        // Only one class teacher per class — clear previous
        await TeacherClass.update({ isClassTeacher: false }, { where: { classId } });
        await row.update({ isClassTeacher: true });
      }
    }
    req.flash('success', 'Teacher assigned to class(es)');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/assignments/teacher-class');
});

router.post('/assignments/teacher-class/:id/set-class-teacher', async (req, res) => {
  try {
    const row = await TeacherClass.findByPk(req.params.id);
    if (row) {
      // Clear existing class teacher for that class
      await TeacherClass.update({ isClassTeacher: false }, { where: { classId: row.classId } });
      await row.update({ isClassTeacher: true });
      req.flash('success', 'Class teacher set');
    }
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/assignments/teacher-class');
});

router.post('/assignments/teacher-class/:id/unset-class-teacher', async (req, res) => {
  try {
    await TeacherClass.update({ isClassTeacher: false }, { where: { id: req.params.id } });
    req.flash('success', 'Class teacher role removed');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/assignments/teacher-class');
});

router.post('/assignments/teacher-class/:id/remove', async (req, res) => {
  try {
    await TeacherClass.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Assignment removed');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/assignments/teacher-class');
});

// ── Assign Subjects to Classes ─────────────────────────────────────────────────
router.get('/assignments/class-subject', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const [classes, subjects, { count, rows: assignments }] = await Promise.all([
    Class.findAll({ include: ['department'] }),
    Subject.findAll({ include: ['class'] }),
    ClassSubject.findAndCountAll({ include: [{ model: Class, as: 'class' }, { model: Subject, as: 'subject' }], limit, offset: (page - 1) * limit })
  ]);
  res.render('admin/assign-class-subject', {
    title: 'Assign Subjects to Classes', classes, subjects, assignments,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/assignments/class-subject', async (req, res) => {
  try {
    const { classId, subjectIds } = req.body;
    const ids = Array.isArray(subjectIds) ? subjectIds : [subjectIds];
    for (const subjectId of ids) {
      await ClassSubject.findOrCreate({ where: { classId, subjectId } });
    }
    req.flash('success', 'Subject(s) assigned to class');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/assignments/class-subject');
});

router.post('/assignments/class-subject/:id/remove', async (req, res) => {
  try {
    await ClassSubject.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Assignment removed');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/assignments/class-subject');
});

// ── Assign Teachers to Subjects ────────────────────────────────────────────────
router.get('/assignments/teacher-subject', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const selectedDeptId = req.query.deptId || '';
  const selectedClassId = req.query.classId || '';

  const [teachers, departments, allClasses] = await Promise.all([
    Teacher.findAll({ where: { isActive: true }, include: ['department'], order: [['fullName', 'ASC']] }),
    Department.findAll({ order: [['name', 'ASC']] }),
    Class.findAll({ include: ['department'], order: [['name', 'ASC']] })
  ]);

  // Classes filtered by dept for the form select
  const classes = selectedDeptId
    ? allClasses.filter(c => c.departmentId == selectedDeptId)
    : allClasses;

  // Subjects filtered by class for the form select
  const subjects = selectedClassId
    ? await Subject.findAll({ where: { classId: selectedClassId }, include: ['class'] })
    : selectedDeptId
      ? await Subject.findAll({ where: { classId: classes.map(c => c.id) }, include: ['class'] })
      : await Subject.findAll({ include: ['class'] });

  // Assignments filtered by dept/class
  const assignWhere = {};
  if (selectedClassId) assignWhere.classId = selectedClassId;
  else if (selectedDeptId && classes.length) assignWhere.classId = classes.map(c => c.id);

  const { count, rows: assignments } = await TeacherSubject.findAndCountAll({
    where: Object.keys(assignWhere).length ? assignWhere : {},
    include: [
      { model: Teacher, as: 'teacher' },
      { model: Subject, as: 'subject' },
      { model: Class, as: 'class', include: ['department'] }
    ],
    order: [[{ model: Class, as: 'class' }, 'name', 'ASC']],
    limit, offset: (page - 1) * limit
  });

  // dept→classes map for cascade JS
  const deptClassMap = {};
  allClasses.forEach(c => {
    const did = c.departmentId;
    if (!deptClassMap[did]) deptClassMap[did] = [];
    deptClassMap[did].push({ id: c.id, name: c.name });
  });

  // class→subjects map for cascade JS
  const classSubjectMap = {};
  const allSubjects = await Subject.findAll({ include: ['class'] });
  allSubjects.forEach(s => {
    if (!classSubjectMap[s.classId]) classSubjectMap[s.classId] = [];
    classSubjectMap[s.classId].push({ id: s.id, name: s.name });
  });

  res.render('admin/assign-teacher-subject', {
    title: 'Assign Teachers to Subjects',
    teachers, departments, classes, subjects, assignments, allClasses,
    deptClassMap, classSubjectMap,
    selectedDeptId, selectedClassId,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/assignments/teacher-subject', async (req, res) => {
  try {
    const { teacherId, classId, subjectIds } = req.body;
    const ids = Array.isArray(subjectIds) ? subjectIds : [subjectIds];
    for (const subjectId of ids) {
      await TeacherSubject.findOrCreate({ where: { teacherId, subjectId, classId } });
    }
    req.flash('success', 'Teacher assigned to subject(s)');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/assignments/teacher-subject');
});

router.post('/assignments/teacher-subject/:id/remove', async (req, res) => {
  try {
    await TeacherSubject.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Assignment removed');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/assignments/teacher-subject');
});

// ── Holidays ───────────────────────────────────────────────────────────────────
router.get('/holidays', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const { count, rows: holidays } = await PublicHoliday.findAndCountAll({
    order: [['date', 'ASC']], limit, offset: (page - 1) * limit
  });
  res.render('admin/holidays', {
    title: 'Public Holidays', holidays,
    pagination: { page, pages: Math.ceil(count / limit), total: count },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/holidays', async (req, res) => {
  try {
    await PublicHoliday.create(req.body);
    req.flash('success', 'Holiday added');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/holidays');
});

router.post('/holidays/:id/delete', async (req, res) => {
  try {
    await PublicHoliday.destroy({ where: { id: req.params.id } });
    req.flash('success', 'Holiday removed');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect('/admin/holidays');
});

// ── Attendance Report ──────────────────────────────────────────────────────────
router.get('/reports/attendance', async (req, res) => {
  const classes = await Class.findAll({ include: ['department'] });
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  let report = null, className = '';

  if (req.query.classId) {
    const cls = await Class.findByPk(req.query.classId);
    className = cls ? cls.name : '';
    const students = await Student.findAll({ where: { classId: req.query.classId, isActive: true }, order: [['fullName', 'ASC']] });
    const attendance = await Attendance.findAll({
      where: { classId: req.query.classId },
      include: ['student'],
      order: [['date', 'DESC']]
    });

    // Compute school days (weekdays minus holidays) in current year range
    const currentYear = await getCurrentYear();
    let schoolDays = 0;
    if (currentYear) {
      const holidays = await PublicHoliday.findAll();
      const holidayDates = new Set(holidays.map(h => h.date));
      let d = moment(currentYear.startDate);
      const end = moment(currentYear.endDate);
      while (d.isSameOrBefore(end, 'day')) {
        const dow = d.day();
        if (dow !== 0 && dow !== 6 && !holidayDates.has(d.format('YYYY-MM-DD'))) schoolDays++;
        d.add(1, 'day');
      }
    }

    const allSummary = students.map(s => {
      const records = attendance.filter(a => a.studentId === s.id);
      return {
        student: s,
        present: records.filter(r => r.status === 'present').length,
        absent: records.filter(r => r.status === 'absent').length,
        sick: records.filter(r => r.status === 'sick').length,
        total: records.length,
        schoolDays
      };
    });
    const total = allSummary.length;
    const offset = (page - 1) * limit;
    const summary = allSummary.slice(offset, offset + limit);
    report = { summary, attendance };
  }

  res.render('admin/report-attendance', {
    title: 'Attendance Report', classes, report, className,
    selectedClass: req.query.classId,
    pagination: report ? { page, pages: Math.ceil(report.summary.length / limit + (page - 1)), total: report.summary.length + (page - 1) * limit } : null,
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

// ── Print Attendance (full class, no pagination) ───────────────────────────────
router.get('/reports/attendance/print', async (req, res) => {
  try {
    const cls = await Class.findByPk(req.query.classId, { include: ['department'] });
    const students = await Student.findAll({ where: { classId: req.query.classId, isActive: true }, order: [['fullName', 'ASC']] });
    const attendance = await Attendance.findAll({
      where: { classId: req.query.classId },
      include: ['student'], order: [['date', 'DESC']]
    });
    const currentYear = await getCurrentYear();
    let schoolDays = 0;
    if (currentYear) {
      const holidays = await PublicHoliday.findAll();
      const holidayDates = new Set(holidays.map(h => h.date));
      let d = moment(currentYear.startDate);
      const end = moment(currentYear.endDate);
      while (d.isSameOrBefore(end, 'day')) {
        const dow = d.day();
        if (dow !== 0 && dow !== 6 && !holidayDates.has(d.format('YYYY-MM-DD'))) schoolDays++;
        d.add(1, 'day');
      }
    }
    const summary = students.map(s => {
      const records = attendance.filter(a => a.studentId === s.id);
      return {
        student: s,
        present: records.filter(r => r.status === 'present').length,
        absent: records.filter(r => r.status === 'absent').length,
        sick: records.filter(r => r.status === 'sick').length,
        total: records.length, schoolDays
      };
    });
    res.render('admin/print-attendance', { title: 'Print Attendance', cls, summary, currentYear, admin: req.session.admin });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/admin/reports/attendance');
  }
});

// ── Examination Report ────────────────────────────────────────────────────────
router.get('/reports/examination', async (req, res) => {
  const classes = await Class.findAll({ include: ['department'] });
  const currentYear = await getCurrentYear();
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  let report = null, total = 0;

  if (req.query.classId) {
    const where = { classId: req.query.classId };
    if (req.query.term) where.term = req.query.term;
    if (req.query.year) where.academicYear = req.query.year;
    const { count, rows: marks } = await Mark.findAndCountAll({
      where,
      include: [
        { model: Student, as: 'student', include: ['class', 'stream'] },
        { model: Subject, as: 'subject' }
      ],
      order: [[{ model: Student, as: 'student' }, 'fullName', 'ASC']],
      limit, offset: (page - 1) * limit
    });
    report = marks;
    total = count;
  }

  res.render('admin/report-examination', {
    title: 'Examination Report', classes, report, currentYear,
    selectedClass: req.query.classId,
    selectedTerm: req.query.term || '',
    selectedYear: req.query.year || '',
    pagination: { page, pages: Math.ceil(total / limit), total },
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

// ── Helper: build class student reports ───────────────────────────────────────
async function buildClassReports(classId, term, year) {
  const cls = await Class.findByPk(classId, { include: ['department'] });
  const students = await Student.findAll({ where: { classId, isActive: true }, include: ['class', 'stream'], order: [['fullName', 'ASC']] });
  const deptCode = cls && cls.department ? cls.department.code : '';
  const isPrimary = deptCode === 'Primary' || deptCode === 'EYC';
  const studentReports = await Promise.all(students.map(async student => {
    const marks = await Mark.findAll({ where: { studentId: student.id, term, academicYear: year }, include: ['subject'] });
    const attendance = await Attendance.findAll({ where: { studentId: student.id } });
    const presentDays = attendance.filter(a => a.status === 'present').length;
    const totalDays = attendance.length;
    const reportComment = await ReportComment.findOne({ where: { studentId: student.id, classId, term, academicYear: year } });
    return { student: student.toJSON(), marks: marks.map(m => m.toJSON()), presentDays, totalDays, reportComment: reportComment ? reportComment.toJSON() : null };
  }));
  return { cls: cls ? cls.toJSON() : {}, deptCode, isPrimary, studentReports };
}

// ── Print All Progressive Reports (CA) for a Class ────────────────────────────
router.get('/reports/print-all-report-cards', async (req, res) => {
  try {
    const { classId, term, year } = req.query;
    if (!classId) {
      return res.status(400).send('<h2>Missing classId parameter</h2><a href="/admin/reports/examination">Go back</a>');
    }
    const t = term || 'Term 1', y = year || '2024/2025';
    const { cls, studentReports } = await buildClassReports(classId, t, y);
    res.render('admin/print-all-progressive', {
      title: 'Progressive Report Cards — ' + (cls.name || ''),
      cls, studentReports, term: t, year: y, getRemark,
      admin: req.session && req.session.admin ? req.session.admin : {}
    });
  } catch (err) {
    console.error('print-all-progressive error:', err);
    res.status(500).send('<h2>Error: ' + err.message + '</h2><a href="/admin/reports/examination">Go back</a>');
  }
});

// ── Print All Final Reports (FE) for a Class ──────────────────────────────────
router.get('/reports/print-all-final-reports', async (req, res) => {
  try {
    const { classId, term, year } = req.query;
    if (!classId) {
      return res.status(400).send('<h2>Missing classId parameter</h2><a href="/admin/reports/examination">Go back</a>');
    }
    const t = term || 'Term 1', y = year || '2024/2025';
    const { cls, deptCode, isPrimary, studentReports } = await buildClassReports(classId, t, y);
    // Collect all unique subjects across all student marks
    const subjectMap = {};
    studentReports.forEach(sr => sr.marks.forEach(m => {
      if (m.subject && !subjectMap[m.subjectId]) subjectMap[m.subjectId] = m.subject;
    }));
    const subjects = Object.values(subjectMap);
    res.render('admin/print-all-final', {
      title: 'Final Report Cards — ' + (cls.name || ''),
      cls, deptCode, isPrimary, studentReports, subjects, term: t, year: y,
      admin: req.session && req.session.admin ? req.session.admin : {}
    });
  } catch (err) {
    console.error('print-all-final error:', err);
    res.status(500).send('<h2>Error: ' + err.message + '</h2><a href="/admin/reports/examination">Go back</a>');
  }
});

// ── Exam Analysis (Admin) ─────────────────────────────────────────────────────
router.get('/reports/exam-analysis', async (req, res) => {
  const currentYear = await getCurrentYear();
  const classes = await Class.findAll({ include: ['department'] });
  const term = req.query.term || (currentYear && currentYear.terms && currentYear.terms[0] ? currentYear.terms[0].name : 'Term 1');
  const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');
  const academicYears = await AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] });

  let analysisData = null;
  if (req.query.classId) {
    const cls = await Class.findByPk(req.query.classId, { include: ['department'] });
    const deptCode = cls && cls.department ? cls.department.code : '';
    const marks = await Mark.findAll({
      where: { classId: req.query.classId, term, academicYear: year },
      include: ['subject', 'student']
    });
    const totalStudents = await Student.count({ where: { classId: req.query.classId, isActive: true } });
    analysisData = { cls: cls ? cls.toJSON() : null, deptCode, totalStudents, subjects: buildExamAnalysis(marks.map(m => m.toJSON()), deptCode) };
  }

  res.render('admin/exam-analysis', {
    title: 'Exam Analysis', classes, analysisData, term, year, currentYear, academicYears,
    admin: req.session.admin, error: req.flash('error'), success: req.flash('success')
  });
});

// ── Admin Academic Report (print) ─────────────────────────────────────────────
router.get('/reports/academic-report/:classId', async (req, res) => {
  try {
    const currentYear = await getCurrentYear();
    const term = req.query.term || (currentYear && currentYear.terms && currentYear.terms[0] ? currentYear.terms[0].name : 'Term 1');
    const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');
    const cls = await Class.findByPk(req.params.classId, { include: ['department'] });
    const deptCode = cls && cls.department ? cls.department.code : '';
    const isPrimary = deptCode === 'Primary' || deptCode === 'EYC';
    const students = await Student.findAll({ where: { classId: req.params.classId, isActive: true }, include: ['stream'], order: [['fullName', 'ASC']] });
    const marks = await Mark.findAll({ where: { classId: req.params.classId, term, academicYear: year }, include: ['subject'] });
    const marksByStudent = {};
    marks.forEach(m => { if (!marksByStudent[m.studentId]) marksByStudent[m.studentId] = []; marksByStudent[m.studentId].push(m.toJSON()); });
    const studentReports = students.map(s => ({ student: s.toJSON(), marks: marksByStudent[s.id] || [] }));
    const subjectMap = {};
    marks.forEach(m => { if (m.subject && !subjectMap[m.subjectId]) subjectMap[m.subjectId] = m.subject.toJSON(); });
    const subjects = Object.values(subjectMap);
    res.render('admin/academic-report', {
      title: 'Academic Report', cls: cls ? cls.toJSON() : {}, deptCode, isPrimary, subjects, studentReports,
      term, year, getPrimaryExamGrade, primaryExamPassed, secondaryExamPassed,
      admin: req.session.admin
    });
  } catch (err) {
    console.error('academic-report error:', err);
    res.status(500).send('<h2>Error: ' + err.message + '</h2><a href="/admin/reports/exam-analysis">Go back</a>');
  }
});

// ── Admin Reset Teacher Password ─────────────────────────────────────────────
router.post('/teachers/:id/reset-password', async (req, res) => {
  try {
    const teacher = await Teacher.findByPk(req.params.id);
    if (!teacher) throw new Error('Teacher not found');

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await teacher.update({ resetToken: token, resetTokenExpiry: expiry, mustChangePassword: true });
    await sendPasswordResetEmail(teacher, token);
    req.flash('success', `Password reset link sent to ${teacher.email}`);
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
  }
  res.redirect('/admin/teachers');
});

module.exports = router;

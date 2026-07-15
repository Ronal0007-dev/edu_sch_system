const express = require('express');
const router = express.Router();
const moment = require('moment');
const { Op } = require('sequelize');
const { requireTeacher } = require('../middleware/auth');
const { calculateScore, getGrade, getRemark, getPrimaryExamGrade, primaryExamPassed, secondaryExamPassed, buildExamAnalysis, isArtDesignSubject, calculateArtScore, artGrade, ART_MAX } = require('../utils/grading');
const {
  AcademicYear, Term, Teacher, Class, Student, Stream, Subject,
  Attendance, Mark, TeacherClass, TeacherSubject, PublicHoliday, ReportComment
} = require('../models');

router.use(requireTeacher);

// ── Helper: current year ───────────────────────────────────────────────────────
async function getCurrentYear() {
  return AcademicYear.findOne({ where: { isCurrent: true }, include: ['terms'] });
}

function activeStudentWhere(extra = {}) {
  return { isActive: true, status: 'Active', ...extra };
}

async function getTeacherAssignedStreamId(teacherId, classId) {
  if (!teacherId || !classId) return null;
  const rows = await TeacherClass.findAll({
    where: { teacherId, classId: parseInt(classId) }
  });
  const streamAssignment = rows.find(row => row.streamId);
  return streamAssignment ? streamAssignment.streamId : null;
}

function buildTeacherStudentWhere(classId, streamId, extra = {}) {
  const where = activeStudentWhere({ classId: parseInt(classId), ...extra });
  if (streamId) where.streamId = streamId;
  return where;
}

async function getTeacherClassStreamMap(teacherId) {
  if (!teacherId) return {};
  const rows = await TeacherClass.findAll({
    where: { teacherId },
    include: [{ model: Class, as: 'class' }, { model: Stream, as: 'stream' }]
  });
  const classStreamMap = {};
  rows.forEach(row => {
    if (!row.class) return;
    const cid = String(row.class.id);
    if (!classStreamMap[cid]) classStreamMap[cid] = [];
    if (row.stream) {
      const existing = classStreamMap[cid].find(s => String(s.id) === String(row.stream.id));
      if (!existing) classStreamMap[cid].push({ id: String(row.stream.id), name: row.stream.name });
    }
  });
  return classStreamMap;
}

async function getTeacherClassStream(teacherId, classId, streamId) {
  if (!teacherId || !classId || !streamId) return null;
  const row = await TeacherClass.findOne({ where: { teacherId, classId: parseInt(classId), streamId: parseInt(streamId) }, include: [{ model: Stream, as: 'stream' }] });
  return row && row.stream ? row.stream.toJSON() : null;
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
      include: [{
        model: Class,
        as: 'class',
        include: [
          'department',
          { model: Student, as: 'students', where: activeStudentWhere(), required: false }
        ]
      }, { model: Stream, as: 'stream' }]
    });
    const assignedClasses = teacherClassRows.map(tc => ({
      ...tc.class.toJSON(),
      isClassTeacher: tc.isClassTeacher,
      assignmentId: tc.id,
      streamId: tc.streamId || null,
      stream: tc.stream ? tc.stream.toJSON() : null
    })).filter(c => c.id);
    const classTeacherClasses = assignedClasses.filter(c => c.isClassTeacher);
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
      teacher: { ...teacher.toJSON(), classes: assignedClasses, teacherSubjects: teacherSubjectRows, classTeacherClasses },
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
    include: [{ model: Class, as: 'class', include: ['department'] }, { model: Stream, as: 'stream' }]
  });
  const classes = teacherClassRows.map(tc => tc.class).filter(Boolean);
  const classStreamMap = {};
  teacherClassRows.forEach(tc => {
    if (!tc.class) return;
    const cid = String(tc.class.id);
    if (!classStreamMap[cid]) classStreamMap[cid] = [];
    if (tc.stream) {
      const existing = classStreamMap[cid].find(s => String(s.id) === String(tc.stream.id));
      if (!existing) classStreamMap[cid].push({ id: String(tc.stream.id), name: tc.stream.name });
    }
  });

  let students = [], selectedClass = null, selectedStream = null;
  const today = moment().format('YYYY-MM-DD');
  let canTakeAttendance = true, blockReason = '';
  const dayOfWeek = moment().day();
  if (dayOfWeek === 0 || dayOfWeek === 6) { canTakeAttendance = false; blockReason = 'Attendance is not taken on weekends'; }
  const holiday = await PublicHoliday.findOne({ where: { date: today } });
  if (holiday) { canTakeAttendance = false; blockReason = `Today is a public holiday: ${holiday.name}`; }

  const selectedStreamId = req.query.streamId ? parseInt(req.query.streamId) : null;

  if (req.query.classId) {
    const resolvedStreamId = selectedStreamId || await getTeacherAssignedStreamId(req.session.teacher.id, req.query.classId);
    selectedClass = await Class.findByPk(req.query.classId);
    selectedStream = resolvedStreamId ? await getTeacherClassStream(req.session.teacher.id, req.query.classId, resolvedStreamId) : null;
    const rawStudents = await Student.findAll({
      where: buildTeacherStudentWhere(req.query.classId, resolvedStreamId),
      include: ['stream'],
      order: [['fullName', 'ASC']]
    });
    const existingAttendance = await Attendance.findAll({ where: { classId: req.query.classId, date: today } });
    students = rawStudents.map(s => ({
      ...s.toJSON(),
      existingStatus: (existingAttendance.find(a => a.studentId === s.id) || {}).status || null,
    }));
  }

  res.render('teacher/attendance', {
    title: 'Take Attendance', classes, students, selectedClass, selectedStream, today, canTakeAttendance, blockReason,
    classStreamMap, selectedStreamId, teacher: req.session.teacher, error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/attendance/submit', async (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    if ([0, 6].includes(moment().day())) throw new Error('Cannot take attendance on weekends');
    const holiday = await PublicHoliday.findOne({ where: { date: today } });
    if (holiday) throw new Error(`Cannot take attendance on ${holiday.name}`);
    const { classId, streamId } = req.body;
    const resolvedStreamId = streamId ? parseInt(streamId) : await getTeacherAssignedStreamId(req.session.teacher.id, classId);
    const students = await Student.findAll({ where: buildTeacherStudentWhere(classId, resolvedStreamId) });
    for (const student of students) {
      const status = req.body[`status_${student.id}`];
      if (status) {
        await Attendance.upsert({ studentId: student.id, classId, date: today, status, takenBy: req.session.teacher.id });
      }
    }
    req.flash('success', 'Attendance saved successfully');
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect(`/teacher/attendance?classId=${req.body.classId}&streamId=${req.body.streamId || ''}`);
});

// ── Print Attendance ───────────────────────────────────────────────────────────
router.get('/attendance/print', async (req, res) => {
  try {
    const { classId, date, streamId } = req.query;
    const resolvedStreamId = streamId ? parseInt(streamId) : await getTeacherAssignedStreamId(req.session.teacher.id, classId);
    const cls = await Class.findByPk(classId, { include: ['department'] });
    const students = await Student.findAll({ where: buildTeacherStudentWhere(classId, resolvedStreamId), order: [['fullName', 'ASC']] });
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
    const streamId = await getTeacherAssignedStreamId(req.session.teacher.id, req.query.classId);
    const studentRows = await Student.findAll({
      where: buildTeacherStudentWhere(req.query.classId, streamId),
      attributes: ['id']
    });
    const studentIds = studentRows.map(row => row.id);
    const { count, rows } = await Attendance.findAndCountAll({
      where: { classId: req.query.classId, date: req.query.date, studentId: studentIds },
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
  const teacherClassRows = await TeacherClass.findAll({
    where: { teacherId: req.session.teacher.id },
    include: [{ model: Class, as: 'class' }, { model: Stream, as: 'stream' }]
  });
  const classStreamMap = {};
  teacherClassRows.forEach(tc => {
    if (!tc.class) return;
    const cid = String(tc.class.id);
    if (!classStreamMap[cid]) classStreamMap[cid] = [];
    if (tc.stream) {
      const existing = classStreamMap[cid].find(s => String(s.id) === String(tc.stream.id));
      if (!existing) classStreamMap[cid].push({ id: String(tc.stream.id), name: tc.stream.name });
    }
  });

  // ── Cascade: Dept → Class → Subject ─────────────────────────────────────────
  // deptMap: unique departments
  const deptMap = new Map();
  teacherSubjectRows.forEach(ts => {
    if (ts.class && ts.class.department) {
      const dept = ts.class.department;
      if (!deptMap.has(dept.id)) deptMap.set(dept.id, dept.toJSON ? dept.toJSON() : dept);
    }
  });
  const uniqueDepts = [...deptMap.values()];

  // cascadeMap[deptId][classId] = { class, subjects: [{id, name}] }
  const cascadeMap = {};
  teacherSubjectRows.forEach(ts => {
    if (!ts.class || !ts.class.department || !ts.subject) return;
    const deptId = String(ts.class.department.id);
    const classId = String(ts.class.id);
    if (!cascadeMap[deptId]) cascadeMap[deptId] = {};
    if (!cascadeMap[deptId][classId]) {
      const cls = ts.class.toJSON ? ts.class.toJSON() : ts.class;
      cascadeMap[deptId][classId] = { cls, subjects: [] };
    }
    const subj = ts.subject.toJSON ? ts.subject.toJSON() : ts.subject;
    if (!cascadeMap[deptId][classId].subjects.find(s => s.id === subj.id)) {
      cascadeMap[deptId][classId].subjects.push(subj);
    }
  });

  // Only show open terms for selection
  const openTerms = currentYear && currentYear.terms
    ? currentYear.terms.filter(t => t.isOpen)
    : [];

  const term = req.query.term || (openTerms[0] ? openTerms[0].name : 'Term 1');
  const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');

  let students = [], selectedSubject = null, selectedClass = null, existingMarks = {};
  let selectedStream = null;
  let deptCode = '', isArtDesign = false;
  const selectedDeptId  = req.query.deptId   || '';
  const selectedClassId = req.query.classId  || '';
  const selectedSubjectId = req.query.subjectId || '';
  const selectedStreamId = req.query.streamId ? parseInt(req.query.streamId) : null;

  if (selectedSubjectId && selectedClassId) {
    selectedSubject = await Subject.findByPk(selectedSubjectId);
    selectedClass   = await Class.findByPk(selectedClassId, { include: ['department'] });
    deptCode        = selectedClass && selectedClass.department ? selectedClass.department.code : '';
    isArtDesign     = isArtDesignSubject(
      selectedSubject ? selectedSubject.name : '',
      selectedClass ? selectedClass.name : '',
      deptCode
    );
    const resolvedStreamId = selectedStreamId || await getTeacherAssignedStreamId(req.session.teacher.id, selectedClassId);
    selectedStream = resolvedStreamId ? await getTeacherClassStream(req.session.teacher.id, selectedClassId, resolvedStreamId) : null;
    students = await Student.findAll({
      where: buildTeacherStudentWhere(selectedClassId, resolvedStreamId),
      include: ['stream'], order: [['fullName', 'ASC']]
    });
    const marks = await Mark.findAll({ where: { subjectId: selectedSubjectId, classId: selectedClassId, term, academicYear: year } });
    marks.forEach(m => { existingMarks[m.studentId] = m; });
  }

  res.render('teacher/marks', {
    title: 'Enter Marks',
    teacherSubjectRows, uniqueDepts, cascadeMap,
    students, selectedSubject, selectedClass, existingMarks,
    deptCode, selectedDeptId, selectedClassId, selectedSubjectId, selectedStreamId,
    selectedStream, classStreamMap,
    isArtDesign, ART_MAX,
    term, year, currentYear, openTerms,
    teacher: req.session.teacher,
    error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/marks/save', async (req, res) => {
  try {
    const { classId, subjectId, term, academicYear, section, isArtDesign: artFlag } = req.body;

    // Detect Art & Design mode from hidden form field sent by the view
    const artMode = artFlag === '1';

    if (section === 'fe') {
      // ── Save Final Exam scores only ────────────────────────────────────────
      const feIds = Object.keys(req.body).filter(k => k.startsWith('fe_')).map(k => k.replace('fe_',''));
      for (const studentId of feIds) {
        const finalExam = parseFloat(req.body[`fe_${studentId}`]);
        if (isNaN(finalExam)) continue;
        const finalExamMax = parseFloat(req.body[`femax_${studentId}`]) || null;
        const [mark] = await Mark.findOrCreate({
          where: { studentId, subjectId, classId, term, academicYear },
          defaults: { homework:0, groupWork:0, quiz:0, classWork:0, unitTest:0, totalScore:0, grade:'F', enteredBy: req.session.teacher.id }
        });
        const updateData = { finalExam, enteredBy: req.session.teacher.id };
        if (finalExamMax !== null) updateData.finalExamMax = finalExamMax;
        await mark.update(updateData);
      }
      req.flash('success', 'Final Exam marks saved');
    } else if (artMode) {
      // ── Art & Design: summation out of 72, no weighting/averaging ──────────
      const studentIds = Object.keys(req.body).filter(k => k.startsWith('hw_')).map(k => k.replace('hw_',''));
      for (const studentId of studentIds) {
        const homework  = parseFloat(req.body[`hw_${studentId}`]) || 0;
        const groupWork = parseFloat(req.body[`gw_${studentId}`]) || 0;
        const quiz      = parseFloat(req.body[`qz_${studentId}`]) || 0;
        const classWork = parseFloat(req.body[`cw_${studentId}`]) || 0;
        const unitTest  = parseFloat(req.body[`ut_${studentId}`]) || 0;
        const totalScore = calculateArtScore({ homework, groupWork, quiz, classWork, unitTest });
        const grade = artGrade(totalScore); // 'Pass' or 'Fail'
        await Mark.upsert({
          studentId, subjectId, classId, term, academicYear,
          homework, groupWork, quiz, classWork, unitTest,
          gradingMethod: 'summation', totalScore, grade,
          enteredBy: req.session.teacher.id
        });
      }
      req.flash('success', 'Art & Design marks saved (summation out of 72)');
    } else {
      // ── Regular CA: weighted or unweighted ─────────────────────────────────
      const studentIds = Object.keys(req.body).filter(k => k.startsWith('hw_')).map(k => k.replace('hw_',''));
      for (const studentId of studentIds) {
        const homework  = parseFloat(req.body[`hw_${studentId}`]) || 0;
        const groupWork = parseFloat(req.body[`gw_${studentId}`]) || 0;
        const quiz      = parseFloat(req.body[`qz_${studentId}`]) || 0;
        const classWork = parseFloat(req.body[`cw_${studentId}`]) || 0;
        const unitTest  = parseFloat(req.body[`ut_${studentId}`]) || 0;
        const method    = req.body[`method_${studentId}`] || 'weighted';
        const totalScore = calculateScore({ homework, groupWork, quiz, classWork, unitTest }, method);
        const grade = getGrade(totalScore);
        await Mark.upsert({ studentId, subjectId, classId, term, academicYear, homework, groupWork, quiz, classWork, unitTest, gradingMethod: method, totalScore, grade, enteredBy: req.session.teacher.id });
      }
      req.flash('success', 'CA marks saved successfully');
    }
  } catch (err) { req.flash('error', 'Error: ' + err.message); }
  res.redirect(`/teacher/marks?subjectId=${req.body.subjectId}&classId=${req.body.classId}&streamId=${req.body.streamId || ''}&term=${req.body.term}&year=${req.body.academicYear}`);
});

// ── Helper: load student report data ─────────────────────────────────────────
async function loadStudentReportData(studentId, term, year, teacherId = null) {
  const student = await Student.findOne({
    where: { id: studentId, isActive: true, status: 'Active' },
    include: [{ model: Class, as: 'class', include: ['department'] }, 'stream']
  });
  if (!student) throw new Error('Student record not found or not available for reporting');
  if (teacherId && student.classId) {
    const streamId = await getTeacherAssignedStreamId(teacherId, student.classId);
    if (streamId && student.streamId !== streamId) {
      throw new Error('You are not authorized to view this student');
    }
  }
  const marks = await Mark.findAll({ where: { studentId, term, academicYear: year }, include: ['subject'] });
  const attendance = await Attendance.findAll({ where: { studentId } });
  const presentDays = attendance.filter(a => a.status === 'present').length;
  const totalDays = attendance.length;
  const reportComments = await ReportComment.findAll({ where: { studentId, term, academicYear: year } });
  const reportComment = reportComments.find(c => c.classId === student.classId)
    || reportComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    || null;
  const deptCode = student.class && student.class.department ? student.class.department.code : '';
  const isPrimary = deptCode === 'Primary' || deptCode === 'EYC';
  return { student: student.toJSON(), marks: marks.map(m => m.toJSON()), presentDays, totalDays, reportComment: reportComment ? reportComment.toJSON() : null, deptCode, isPrimary };
}

// ── Progressive Report Card (CA only) ────────────────────────────────────────
router.get('/progressive-report/:studentId', async (req, res) => {
  try {
    const currentYear = await getCurrentYear();
    const allTerms = currentYear && currentYear.terms ? currentYear.terms : [];
    const defaultTerm = allTerms[0] ? allTerms[0].name : 'Term 1';
    const term = req.query.term || defaultTerm;
    const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');
    const academicYears = await AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] });
    const data = await loadStudentReportData(req.params.studentId, term, year, req.session.teacher.id);
    res.render('teacher/progressive-report', {
      title: 'Progressive Report Card', ...data, term, year, getRemark,
      isArtDesignSubject, ART_MAX, artGrade,
      currentYear, academicYears, allTerms, teacher: req.session.teacher
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/teacher/report-cards');
  }
});

// ── Final Report Card (Final Exam only) ───────────────────────────────────────
router.get('/final-report/:studentId', async (req, res) => {
  try {
    const currentYear = await getCurrentYear();
    const allTerms = currentYear && currentYear.terms ? currentYear.terms : [];
    const defaultTerm = allTerms[0] ? allTerms[0].name : 'Term 1';
    const term = req.query.term || defaultTerm;
    const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');
    const academicYears = await AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] });
    const data = await loadStudentReportData(req.params.studentId, term, year, req.session.teacher.id);
    res.render('teacher/final-report', {
      title: 'Final Report Card', ...data, term, year, getRemark, getPrimaryExamGrade,
      primaryExamPassed, secondaryExamPassed,
      isArtDesignSubject, ART_MAX, artGrade,
      currentYear, academicYears, allTerms, teacher: req.session.teacher
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/teacher/report-cards');
  }
});

// ── Keep old /report-card route as redirect to progressive ────────────────────
router.get('/report-card/:studentId', (req, res) => {
  res.redirect(`/teacher/progressive-report/${req.params.studentId}?${new URLSearchParams(req.query).toString()}`);
});

// ── Report Cards List ──────────────────────────────────────────────────────────
router.get('/report-cards', async (req, res) => {
  const currentYear = await getCurrentYear();
  const teacherClassRows = await TeacherClass.findAll({
    where: { teacherId: req.session.teacher.id },
    include: [{ model: Class, as: 'class', include: ['students'] }, { model: Stream, as: 'stream' }]
  });
  const classes = teacherClassRows.map(tc => ({
    ...tc.class.toJSON(),
    isClassTeacher: tc.isClassTeacher
  })).filter(c => c.id);
  const classStreamMap = {};
  teacherClassRows.forEach(tc => {
    if (!tc.class) return;
    const cid = String(tc.class.id);
    if (!classStreamMap[cid]) classStreamMap[cid] = [];
    if (tc.stream) {
      const existing = classStreamMap[cid].find(s => String(s.id) === String(tc.stream.id));
      if (!existing) classStreamMap[cid].push({ id: String(tc.stream.id), name: tc.stream.name });
    }
  });
  const academicYears = await AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] });
  res.render('teacher/report-cards', {
    title: 'Report Cards', classes, classStreamMap, currentYear, academicYears,
    teacher: req.session.teacher, error: req.flash('error'), success: req.flash('success')
  });
});

// ── Exam Analysis Dashboard ───────────────────────────────────────────────────
router.get('/exam-analysis', async (req, res) => {
  const currentYear = await getCurrentYear();
  const teacherClassRows = await TeacherClass.findAll({
    where: { teacherId: req.session.teacher.id },
    include: [{ model: Class, as: 'class', include: ['department'] }, { model: Stream, as: 'stream' }]
  });
  const classes = teacherClassRows.map(tc => ({ ...tc.class.toJSON(), isClassTeacher: tc.isClassTeacher })).filter(c => c.id);
  const classStreamMap = {};
  teacherClassRows.forEach(tc => {
    if (!tc.class) return;
    const cid = String(tc.class.id);
    if (!classStreamMap[cid]) classStreamMap[cid] = [];
    if (tc.stream) {
      const existing = classStreamMap[cid].find(s => String(s.id) === String(tc.stream.id));
      if (!existing) classStreamMap[cid].push({ id: String(tc.stream.id), name: tc.stream.name });
    }
  });
  const selectedClassId = req.query.classId || '';
  const selectedStreamId = req.query.streamId ? parseInt(req.query.streamId) : null;
  const term = req.query.term || (currentYear && currentYear.terms && currentYear.terms[0] ? currentYear.terms[0].name : 'Term 1');
  const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');
  const academicYears = await AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] });

  let analysisData = [];
  if (selectedClassId) {
    const resolvedStreamId = selectedStreamId || await getTeacherAssignedStreamId(req.session.teacher.id, selectedClassId);
    const cls = classes.find(c => c.id == selectedClassId) || await Class.findByPk(selectedClassId, { include: ['department'] }).then(c => c ? c.toJSON() : null);
    const deptCode = cls && cls.department ? cls.department.code : '';
    const studentRows = await Student.findAll({ where: buildTeacherStudentWhere(selectedClassId, resolvedStreamId), attributes: ['id'] });
    const studentIds = studentRows.map(r => r.id);
    const marks = await Mark.findAll({
      where: { classId: selectedClassId, term, academicYear: year, studentId: studentIds },
      include: ['subject', 'student']
    });
    const totalStudents = studentIds.length;
    analysisData = { cls, deptCode, totalStudents, subjects: buildExamAnalysis(marks.map(m => m.toJSON()), deptCode) };
  }

  res.render('teacher/exam-analysis', {
    title: 'Exam Analysis', classes, classStreamMap, analysisData, selectedClassId, selectedStreamId, term, year, currentYear, academicYears,
    teacher: req.session.teacher,
    error: req.flash('error'), success: req.flash('success')
  });
});

// ── Academic Report (Final Exam only — printable) ─────────────────────────────
router.get('/academic-report/:classId', async (req, res) => {
  try {
    const currentYear = await getCurrentYear();
    const term = req.query.term || (currentYear && currentYear.terms && currentYear.terms[0] ? currentYear.terms[0].name : 'Term 1');
    const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');
    const cls = await Class.findByPk(req.params.classId, { include: ['department'] });
    const deptCode = cls && cls.department ? cls.department.code : '';
    const isPrimary = deptCode === 'Primary' || deptCode === 'EYC';
    const streamId = await getTeacherAssignedStreamId(req.session.teacher.id, req.params.classId);
    const students = await Student.findAll({ where: buildTeacherStudentWhere(req.params.classId, streamId), include: ['stream'], order: [['fullName', 'ASC']] });
    const marks = await Mark.findAll({
      where: { classId: req.params.classId, term, academicYear: year },
      include: ['subject']
    });
    // Group marks by student
    const marksByStudent = {};
    marks.forEach(m => { if (!marksByStudent[m.studentId]) marksByStudent[m.studentId] = []; marksByStudent[m.studentId].push(m.toJSON()); });
    const studentReports = students.map(s => ({ student: s.toJSON(), marks: marksByStudent[s.id] || [] }));
    // Get unique subjects
    const subjectMap = {};
    marks.forEach(m => { if (m.subject && !subjectMap[m.subjectId]) subjectMap[m.subjectId] = m.subject.toJSON(); });
    const subjects = Object.values(subjectMap);

    res.render('teacher/academic-report', {
      title: 'Academic Report', cls, deptCode, isPrimary, subjects, studentReports,
      term, year, getPrimaryExamGrade, primaryExamPassed, secondaryExamPassed,
      teacher: req.session.teacher
    });
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/teacher/exam-analysis');
  }
});

// ── Report Comments (Class Teacher only) ──────────────────────────────────────
router.get('/comments', async (req, res) => {
  const currentYear = await getCurrentYear();

  // Find classes where this teacher is class teacher
  const ctRows = await TeacherClass.findAll({
    where: { teacherId: req.session.teacher.id, isClassTeacher: true },
    include: [{ model: Class, as: 'class', include: ['department'] }, { model: Stream, as: 'stream' }]
  });
  const ctClasses = ctRows.map(r => ({
    ...r.class.toJSON(),
    isClassTeacher: true,
    streamId: r.streamId || null,
    stream: r.stream ? r.stream.toJSON() : null
  }));

  const classStreamMap = {};
  ctClasses.forEach(cls => {
    const cid = String(cls.id);
    if (!classStreamMap[cid]) classStreamMap[cid] = [];
    classStreamMap[cid].push({ id: cls.streamId ? String(cls.streamId) : '', name: cls.stream ? cls.stream.name : 'All streams' });
  });

  const term = req.query.term || (currentYear && currentYear.terms && currentYear.terms[0] ? currentYear.terms[0].name : 'Term 1');
  const year = req.query.year || (currentYear ? currentYear.name : '2024/2025');
  const academicYears = await AcademicYear.findAll({ include: ['terms'], order: [['startDate', 'DESC']] });

  let students = [], selectedClass = null, existingComments = {}, classMarks = {};
  const selectedStreamId = req.query.streamId ? parseInt(req.query.streamId) : null;

  if (req.query.classId) {
    selectedClass = ctClasses.find(c => c.id == req.query.classId && (!selectedStreamId || c.streamId === selectedStreamId));
    if (!selectedClass) {
      const fallback = ctClasses.find(c => c.id == req.query.classId);
      if (fallback) selectedClass = fallback;
      else {
        req.flash('error', 'You are not the class teacher for this class');
        return res.redirect('/teacher/comments');
      }
    }

    const teacherStreamId = await getTeacherAssignedStreamId(req.session.teacher.id, req.query.classId);
    const resolvedStreamId = selectedStreamId || teacherStreamId;
    const studentWhere = activeStudentWhere({ classId: req.query.classId });
    if (resolvedStreamId) studentWhere.streamId = resolvedStreamId;

    students = await Student.findAll({
      where: studentWhere,
      include: ['stream'],
      order: [['fullName', 'ASC']]
    });

    // Load existing comments
    const comments = await ReportComment.findAll({
      where: { classId: req.query.classId, term, academicYear: year }
    });
    comments.forEach(c => { existingComments[c.studentId] = c; });

    // Load marks summary per student for AI context
    const marks = await Mark.findAll({
      where: { classId: req.query.classId, term, academicYear: year },
      include: ['subject']
    });
    marks.forEach(m => {
      if (!classMarks[m.studentId]) classMarks[m.studentId] = [];
      classMarks[m.studentId].push(m.toJSON());
    });

    // Load attendance per student
    const attendance = await Attendance.findAll({
      where: { classId: req.query.classId }
    });
    const attMap = {};
    students.forEach(s => {
      const recs = attendance.filter(a => a.studentId === s.id);
      attMap[s.id] = {
        present: recs.filter(r => r.status === 'present').length,
        absent: recs.filter(r => r.status === 'absent').length,
        sick: recs.filter(r => r.status === 'sick').length,
        total: recs.length
      };
    });

    students = students.map(s => ({ ...s.toJSON(), attendance: attMap[s.id] || { present: 0, absent: 0, sick: 0, total: 0 }, marks: classMarks[s.id] || [] }));
  }

  res.render('teacher/comments', {
    title: 'Report Comments',
    ctClasses, selectedClass, students, existingComments,
    classStreamMap,
    selectedStreamId, term, year, currentYear, academicYears,
    teacher: req.session.teacher,
    error: req.flash('error'), success: req.flash('success')
  });
});

router.post('/comments/save', async (req, res) => {
  try {
    const { classId, streamId, term, academicYear } = req.body;
    const parsedStreamId = streamId ? parseInt(streamId) : null;

    // Verify this teacher is class teacher for this class/stream
    const ctRow = await TeacherClass.findOne({
      where: { teacherId: req.session.teacher.id, classId: parseInt(classId), streamId: parsedStreamId || null, isClassTeacher: true }
    });
    if (!ctRow) throw new Error('You are not the class teacher for this class');

    const studentWhere = activeStudentWhere({ classId: parseInt(classId) });
    if (parsedStreamId) studentWhere.streamId = parsedStreamId;
    const students = await Student.findAll({ where: studentWhere });
    for (const student of students) {
      const comment = req.body[`comment_${student.id}`];
      if (comment && comment.trim()) {
        await ReportComment.upsert({
          studentId: student.id, classId, teacherId: req.session.teacher.id,
          term, academicYear, comment: comment.trim()
        });
      }
    }
    req.flash('success', 'Comments saved successfully');
  } catch (err) {
    req.flash('error', 'Error: ' + err.message);
  }
  res.redirect(`/teacher/comments?classId=${req.body.classId}&streamId=${req.body.streamId || ''}&term=${req.body.term}&year=${req.body.academicYear}`);
});

// ── AI Generate Comment for one student ───────────────────────────────────────
router.post('/comments/generate', async (req, res) => {
  try {
    const { studentId, classId, streamId, term, academicYear } = req.body;

    // Coerce to integers for reliable DB matching
    const studentIdInt = parseInt(studentId);
    const classIdInt = parseInt(classId);
    const streamIdInt = streamId ? parseInt(streamId) : null;

    if (!studentIdInt || !classIdInt || !term || !academicYear) {
      return res.status(400).json({ error: 'Missing required fields: studentId, classId, term, academicYear' });
    }

    // Verify class teacher — use parseInt to avoid string/int mismatch
    const ctRow = await TeacherClass.findOne({
      where: { teacherId: parseInt(req.session.teacher.id), classId: classIdInt, streamId: streamIdInt || null, isClassTeacher: true }
    });
    if (!ctRow) {
      return res.status(403).json({ error: 'You are not the class teacher for this class' });
    }

    const student = await Student.findOne({
      where: { id: studentIdInt, ...(streamIdInt ? { streamId: streamIdInt } : {}) }
    });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const marks = await Mark.findAll({
      where: { studentId: studentIdInt, classId: classIdInt, term, academicYear },
      include: ['subject']
    });
    const attendance = await Attendance.findAll({
      where: { studentId: studentIdInt, classId: classIdInt }
    });
    const present = attendance.filter(a => a.status === 'present').length;
    const absent = attendance.filter(a => a.status === 'absent').length;
    const sick = attendance.filter(a => a.status === 'sick').length;
    const total = attendance.length;
    const attPct = total > 0 ? Math.round((present / total) * 100) : 0;

    const marksInfo = marks.length > 0
      ? marks.map(m => {
          const subj = m.subject ? m.subject.name : 'Unknown';
          return `${subj}: ${m.totalScore ? m.totalScore.toFixed(1) : 'N/A'} (${m.grade || 'N/A'})`;
        }).join(', ')
      : 'No marks recorded yet';

    const avgScore = marks.length > 0
      ? marks.reduce((s, m) => s + (m.totalScore || 0), 0) / marks.length
      : null;

    // Build first name from full name
    const firstName = student.fullName.split(' ')[0];

    const prompt = `You are a class teacher writing a brief end-of-term report card comment for a student. Be encouraging, honest, and professional. Keep it to 2-3 sentences maximum. Do not use bullet points or headers.

Student name: ${student.fullName} (use first name "${firstName}" in the comment)
Term: ${term}, Academic Year: ${academicYear}
Attendance: ${present} present, ${absent} absent, ${sick} sick out of ${total} recorded days (${attPct}% attendance rate)
Subject results: ${marksInfo}
${avgScore !== null ? `Overall average score: ${avgScore.toFixed(1)}%` : ''}

Write only the report card comment text, nothing else.`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured in your .env file' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Anthropic API error:', response.status, errBody);
      let friendlyError = `API error (${response.status})`;
      try {
        const parsed = JSON.parse(errBody);
        if (parsed.error && parsed.error.message) friendlyError = parsed.error.message;
      } catch(e) {}
      return res.status(500).json({ error: friendlyError });
    }

    const data = await response.json();
    const comment = data.content && data.content[0] && data.content[0].text
      ? data.content[0].text.trim()
      : null;

    if (!comment) {
      console.error('Unexpected API response:', JSON.stringify(data));
      return res.status(500).json({ error: 'No comment returned by AI. Response: ' + JSON.stringify(data) });
    }

    res.json({ comment });
  } catch (err) {
    console.error('Generate comment error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

module.exports = router;

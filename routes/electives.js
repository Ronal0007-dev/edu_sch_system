const express = require("express");
const {
  Class, Department, Student, Stream, Subject, StudentSubject, Teacher, TeacherClass, TeacherSubject,
} = require("../models");
const { requireAny } = require("../middleware/auth");
const { isElectiveClass, isCompulsorySubject, teacherTeachesYear11 } = require("../utils/electives");

const router = express.Router();
router.use(requireAny);

function isAdmin(req) {
  return Boolean(req.session.admin) || (req.session.teacher && req.session.teacher.role === "admin");
}

async function checkYear11TeacherAuth(req, res, next) {
  if (isAdmin(req)) return next();
  const teacherId = req.session.teacher ? req.session.teacher.id : null;
  const canTeach = await teacherTeachesYear11(teacherId);
  if (!canTeach) {
    req.flash("error", "Only teachers who teach Year 11 in Secondary department can access Year 11 subject options.");
    return res.redirect(req.session.teacher && req.session.teacher.role === "academician" ? "/academician/dashboard" : "/teacher/dashboard");
  }
  next();
}

router.use(checkYear11TeacherAuth);

async function allowedClasses(req) {
  const classes = (await Class.findAll({
    include: [{ model: Department, as: "department" }],
    order: [["name", "ASC"]],
  })).filter(isElectiveClass);
  if (isAdmin(req)) return classes;

  const teacher = await Teacher.findById(req.session.teacher.id);
  if (!teacher) return [];
  const [assignedClasses, assignedSubjects] = await Promise.all([
    TeacherClass.findAll({ where: { teacherId: teacher.id } }),
    TeacherSubject.findAll({ where: { teacherId: teacher.id } }),
  ]);
  const ids = new Set([
    ...assignedClasses.map((row) => Number(row.classId)),
    ...assignedSubjects.map((row) => Number(row.classId)),
  ]);
  return classes.filter((cls) => ids.has(Number(cls.id)));
}

async function loadClassData(classId) {
  const [students, subjects] = await Promise.all([
    Student.findAll({
      where: { classId, isActive: true, status: "Active" },
      include: [{ model: Stream, as: "stream" }],
      order: [["fullName", "ASC"]],
    }),
    Subject.findAll({ where: { classId }, order: [["name", "ASC"]] }),
  ]);
  return {
    students,
    compulsory: subjects.filter(isCompulsorySubject),
    optional: subjects.filter((subject) => !isCompulsorySubject(subject)),
  };
}

router.get("/", async (req, res) => {
  try {
    const classes = await allowedClasses(req);
    const selected = classes.find((cls) => String(cls.id) === String(req.query.classId)) || classes[0] || null;
    let data = { students: [], compulsory: [], optional: [] };
    const chosen = {};
    if (selected) {
      data = await loadClassData(selected.id);
      const rows = await StudentSubject.findAll({
        where: { studentId: { $in: data.students.map((student) => student.id) } },
      });
      rows.forEach((row) => { chosen[`${row.studentId}_${row.subjectId}`] = true; });
    }
    res.render(req.session.admin ? "admin/electives" : "teacher/electives", {
      title: "Year 11 Subject Options",
      classes: classes.map((cls) => cls.toJSON()),
      selectedClassId: selected ? selected.id : "",
      students: data.students.map((student) => student.toJSON()),
      compulsory: data.compulsory.map((subject) => subject.toJSON()),
      optional: data.optional.map((subject) => subject.toJSON()),
      chosen,
      basePath: req.baseUrl,
      admin: req.session.admin,
      teacher: req.session.teacher,
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    console.error("Electives error:", err);
    req.flash("error", err.message);
    res.redirect("/");
  }
});

router.post("/save", async (req, res) => {
  const classId = req.body.classId;
  try {
    const classes = await allowedClasses(req);
    if (!classes.some((cls) => String(cls.id) === String(classId))) {
      throw new Error("You are not allowed to manage subject options for this class");
    }
    const data = await loadClassData(classId);
    const optionalIds = new Set(data.optional.map((subject) => Number(subject.id)));
    const studentIds = data.students.map((student) => student.id);

    const rows = [];
    studentIds.forEach((studentId) => {
      [].concat(req.body[`e_${studentId}`] || []).forEach((value) => {
        const subjectId = Number(value);
        if (optionalIds.has(subjectId)) rows.push({ studentId, subjectId });
      });
    });

    if (studentIds.length) {
      await StudentSubject.destroy({ where: { studentId: { $in: studentIds } } });
    }
    if (rows.length) await StudentSubject.bulkCreate(rows);
    req.flash("success", "Subject options saved");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(`${req.baseUrl}?classId=${classId || ""}`);
});

module.exports = router;

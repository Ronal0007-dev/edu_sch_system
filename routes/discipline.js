const express = require("express");
const moment = require("moment");
const {
  AcademicYear,
  Term,
  Department,
  Class,
  Student,
  Teacher,
  DisciplineReason,
  DisciplineRecord,
} = require("../models");
const {
  requireAny
} = require("../middleware/auth");

const router = express.Router();
router.use(requireAny);

function actor(req) {
  return req.session.teacher ?
    {
      type: "teacher",
      id: req.session.teacher.id,
      role: req.session.teacher.role,
      name: req.session.teacher.fullName
    } :
    {
      type: "admin",
      id: null,
      role: "admin",
      name: req.session.admin.username
    };
}

function isAdmin(req) {
  return Boolean(req.session.admin) || (req.session.teacher && req.session.teacher.role === "admin");
}

function isAcademician(req) {
  return req.session.teacher && req.session.teacher.role === "academician";
}

function canManageRecords(req) {
  return isAdmin(req) || isAcademician(req);
}

async function currentTerm() {
  const year = await AcademicYear.findOne({
    where: {
      isCurrent: true
    },
    include: [{
      model: Term,
      as: "terms"
    }]
  });
  const open = year && year.terms ? year.terms.filter((item) => item.isOpen) : [];
  return {
    year: year || null,
    term: open[0] || (year && year.terms ? year.terms[0] : null),
  };
}

function termValues(req, active) {
  const body = req.body || {};
  const query = req.query || {};
  return {
    term: body.term || query.term || (active && active.name ? active.name : "Term 1"),
    academicYear: body.academicYear || query.year || "",
  };
}

async function loadStudents(req, includeGraduated = false) {
  const where = includeGraduated ?
    {
      status: {
        $in: ["Active", "Graduated"]
      }
    } :
{
    isActive: true,
    status: "Active"
  };
  if (isAcademician(req)) {
    const teacher = await Teacher.findById(req.session.teacher.id);
    const classes = await Class.findAll({
      where: {
        departmentId: teacher.departmentId
      }
    });
    where.classId = {
      $in: classes.map((item) => item.id)
    };
  }
  return Student.findAll({
    where,
    include: [{
      model: Class,
      as: "class",
      include: [{
        model: Department,
        as: "department"
      }]
    }, ],
    order: [
      ["fullName", "ASC"]
    ],
  });
}

async function loadRecords(req, where = {}) {
  const records = await DisciplineRecord.findAll({
    where,
    include: [{
        model: Student,
        as: "student",
        include: [{
          model: Class,
          as: "class",
          include: [{
            model: Department,
            as: "department"
          }]
        }]
      },
      {
        model: Teacher,
        as: "awardedBy"
      },
    ],
    order: [
      ["dateGiven", "DESC"],
      ["createdAt", "DESC"]
    ],
  });
  if (!isAcademician(req)) return records;
  return records.filter((record) => record.student && record.student.class && String(record.student.class.departmentId) === String(req.session.teacher.departmentId));
}

function groupRecords(records) {
  const groups = {};
  records.forEach((record) => {
    const json = record.toJSON();
    const key = json.student && json.student.class ? json.student.class.id : "unknown";
    if (!groups[key]) groups[key] = {
      className: json.student && json.student.class ? json.student.class.name : "Unassigned",
      department: json.student && json.student.class && json.student.class.department ? json.student.class.department.name : "-",
      rows: []
    };
    groups[key].rows.push(json);
  });
  return Object.keys(groups).map((key) => groups[key]);
}

async function renderList(req, res, message) {
  const active = (await currentTerm()) || {
    year: null,
    term: null
  };
  const activeTerm = active && active.term ? active.term : null;
  const values = termValues(req, activeTerm);
  if (!values.academicYear && active && active.year) values.academicYear = active.year.name;
  const students = await loadStudents(req);
  const reasons = await DisciplineReason.findAll({
    where: {
      isActive: true
    },
    order: [
      ["points", "DESC"],
      ["name", "ASC"]
    ]
  });
  const reasonGroups = {
    merits: reasons.filter((reason) => reason.points > 0).slice(0, 10),
    demerits: reasons.filter((reason) => reason.points < 0).slice(0, 10),
  };
  const where = {
    term: values.term,
    academicYear: values.academicYear
  };
  if (!isAdmin(req) && !isAcademician(req)) where.awardedByTeacherId = req.session.teacher.id;
  const records = await loadRecords(req, where);
  const totals = {};
  records.forEach((row) => {
    totals[row.studentId] = (totals[row.studentId] || 0) + row.points;
  });
  const role = isAdmin(req) ? "admin" : "teacher";
  const basePath = req.baseUrl === "/admin/discipline" ? "/admin/discipline" : req.baseUrl === "/academician/discipline" ? "/academician/discipline" : req.baseUrl === "/teacher/discipline" ? "/teacher/discipline" : "/discipline";
  res.render(`${role}/discipline`, {
    title: "Discipline Record",
    user: req.session.teacher || req.session.admin,
    teacher: req.session.teacher,
    admin: req.session.admin,
    students: students.map((item) => item.toJSON()),
    reasons: reasons.map((item) => item.toJSON()),
    reasonGroups: {
      merits: reasonGroups.merits.map((item) => item.toJSON()),
      demerits: reasonGroups.demerits.map((item) => item.toJSON()),
    },
    groups: groupRecords(records),
    records: records.map((item) => item.toJSON()),
    totals,
    term: values.term,
    year: values.academicYear,
    terms: active && active.year && active.year.terms ? active.year.terms : [],
    isAdmin: isAdmin(req),
    isAcademician: isAcademician(req),
    basePath,
    error: message ? [message] : req.flash("error"),
    success: req.flash("success"),
  });
}

router.get("/", async (req, res) => {
  try {
    await renderList(req, res);
  } catch (err) {
    console.error("Discipline list error:", err);
    req.flash("error", err.message);
    res.redirect(req.baseUrl || "/discipline");
  }
});
router.get("/print", async (req, res) => {
  const active = await currentTerm();
  const values = termValues(req, active && active.term ? active.term : null);
  if (!values.academicYear && active && active.year) values.academicYear = active.year.name;
  const where = {
    term: values.term,
    academicYear: values.academicYear
  };
  if (req.query.studentId) where.studentId = req.query.studentId;
  if (!isAdmin(req) && !isAcademician(req)) where.awardedByTeacherId = req.session.teacher.id;
  const records = await loadRecords(req, where);
  res.render("discipline-print", {
    title: "Discipline Record",
    records: records.map((item) => item.toJSON()),
    term: values.term,
    year: values.academicYear
  });
});

router.get("/student/:id", async (req, res) => {
  const active = await currentTerm();
  const values = termValues(req, active && active.term ? active.term : null);
  if (!values.academicYear && active && active.year) values.academicYear = active.year.name;
  const student = isAdmin(req)
    ? await Student.findById(req.params.id, {
      include: [{ model: Class, as: "class", include: [{ model: Department, as: "department" }] }],
    })
    : (await loadStudents(req)).find((item) => String(item.id) === String(req.params.id));
  if (!student) return res.status(404).render("404", {
    title: "Student Not Found",
    user: actor(req)
  });
  const records = await loadRecords(req, {
    studentId: student.id,
    term: values.term,
    academicYear: values.academicYear
  });
  if (!isAdmin(req) && !isAcademician(req) && !records.some((item) => String(item.awardedByTeacherId) === String(req.session.teacher.id))) return res.status(403).send("Not authorized");
  res.render("discipline-student", {
    title: "Student Discipline Record",
    student: student.toJSON(),
    records: records.map((item) => item.toJSON()),
    total: records.reduce((sum, item) => sum + item.points, 0),
    term: values.term,
    year: values.academicYear,
    admin: req.session.admin,
    teacher: req.session.teacher
  });
});

router.post("/records", async (req, res) => {
  try {
    const active = await currentTerm();
    const values = termValues(req, active && active.term ? active.term : null);
    if (!values.academicYear && active && active.year) values.academicYear = active.year.name;
    const student = await Student.findById(req.body.studentId, {
      include: [{
        model: Class,
        as: "class"
      }]
    });
    const reasonDefinition = await DisciplineReason.findOne({
      where: {
        id: req.body.reasonId,
        isActive: true
      },
    });
    const points = reasonDefinition ? reasonDefinition.points : null;
    if (!student || !reasonDefinition || !Number.isInteger(points) || points === 0 || !values.term || !values.academicYear) throw new Error("Select an active discipline reason.");
    if (isAcademician(req) && (!student.class || String(student.class.departmentId) !== String(req.session.teacher.departmentId))) throw new Error("You may only record students in your department.");
    const current = actor(req);
    await DisciplineRecord.create({
      studentId: student.id,
      reasonId: reasonDefinition ? reasonDefinition.id : null,
      awardedByTeacherId: current.id,
      awardedByName: current.name,
      awardedByRole: current.role,
      reason: reasonDefinition ? reasonDefinition.name : String(req.body.reason || "Discipline record").trim(),
      points,
      note: String(req.body.note || "").trim() || null,
      dateGiven: req.body.dateGiven || moment().format("YYYY-MM-DD"),
      term: values.term,
      academicYear: values.academicYear,
    });
    req.flash("success", "Discipline record saved.");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(req.body.redirect || "/discipline");
});

router.post("/reasons", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Not authorized");
  try {
    const points = parseInt(req.body.points, 10);
    if (!req.body.name || !Number.isInteger(points) || points === 0) throw new Error("Reason and a non-zero point value are required.");
    await DisciplineReason.create({
      name: String(req.body.name).trim(),
      points,
      description: String(req.body.description || "").trim() || null
    });
    req.flash("success", "Discipline reason created.");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect("/admin/discipline");
});

router.post("/records/:id/delete", async (req, res) => {
  if (!canManageRecords(req)) return res.status(403).send("Not authorized");
  if (isAcademician(req)) {
    const record = await DisciplineRecord.findById(req.params.id, {
      include: [{
        model: Student,
        as: "student",
        include: [{
          model: Class,
          as: "class"
        }]
      }]
    });
    if (!record || !record.student || !record.student.class || String(record.student.class.departmentId) !== String(req.session.teacher.departmentId)) return res.status(403).send("Not authorized");
  }
  await DisciplineRecord.destroy({
    where: {
      id: req.params.id
    }
  });
  req.flash("success", "Discipline record deleted.");
  res.redirect(req.body.redirect || "/admin/discipline");
});

router.post("/records/:id/update", async (req, res) => {
  if (!canManageRecords(req)) return res.status(403).send("Not authorized");
  try {
    if (isAcademician(req)) {
      const record = await DisciplineRecord.findById(req.params.id, {
        include: [{
          model: Student,
          as: "student",
          include: [{
            model: Class,
            as: "class"
          }]
        }]
      });
      if (!record || !record.student || !record.student.class || String(record.student.class.departmentId) !== String(req.session.teacher.departmentId)) throw new Error("You may only manage records in your department.");
    }
    const points = parseInt(req.body.points, 10);
    if (!Number.isInteger(points) || points === 0) throw new Error("Points must be a non-zero number.");
    await DisciplineRecord.update({
      points,
      reason: String(req.body.reason || "Discipline record").trim(),
      note: String(req.body.note || "").trim() || null,
      dateGiven: req.body.dateGiven,
    }, {
      where: {
        id: req.params.id
      }
    });
    req.flash("success", "Discipline record updated.");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(req.body.redirect || "/admin/discipline");
});

router.post("/reset", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Not authorized");
  const term = String(req.body.term || "").trim();
  const academicYear = String(req.body.academicYear || "").trim();
  if (!term || !academicYear) return res.status(400).send("Term and academic year are required.");
  const deleted = await DisciplineRecord.destroy({
    where: {
      term
    },
  });
  req.flash("success", `Discipline records reset for ${term} (${academicYear}).`);
  req.flash("success", `${deleted} student discipline record${deleted === 1 ? "" : "s"} removed.`);
  res.redirect(`/admin/discipline?term=${encodeURIComponent(term)}&year=${encodeURIComponent(academicYear)}`);
});

router.post("/reasons/:id/delete", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Not authorized");
  await DisciplineReason.update({
    isActive: false
  }, {
    where: {
      id: req.params.id
    }
  });
  req.flash("success", "Discipline reason archived.");
  res.redirect("/admin/discipline");
});

module.exports = router;

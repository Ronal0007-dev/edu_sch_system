const express = require("express");
const router = express.Router();
const {
  LessonPlan,
  LessonPlanFeedback,
  Teacher,
  TeacherSubject,
  Class,
  Subject,
  Department,
  Term,
} = require("../models");

function currentUser(req) {
  return req.session.teacher || req.session.admin;
}

function portal(req) {
  return req.session.admin || (req.session.teacher && req.session.teacher.role === "admin") ? "admin" : "teacher";
}

function lessonPlanPath(req, id) {
  if (req.session.admin) return `/admin/lesson-plans/${id}`;
  if (req.session.teacher && req.session.teacher.role === "academician") {
    return `/academician/lesson-plans/${id}`;
  }
  return `/teacher/lesson-plans/${id}`;
}

function portalBase(req) {
  if (req.session.admin) return "/admin";
  if (req.session.teacher && req.session.teacher.role === "academician") return "/academician";
  return "/teacher";
}

function isReviewer(req) {
  return !!req.session.admin || (req.session.teacher && req.session.teacher.role === "academician");
}

function requireLessonPlanAccess(req, res, next) {
  if (req.session.admin || req.session.teacher) return next();
  req.flash("error", "Please sign in to access lesson plans.");
  return res.redirect("/");
}

function cleanRichText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\sjavascript\s*:/gi, "");
}

function parseTags(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean).slice(0, 30) : [];
  } catch (err) {
    return String(value).split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 30);
  }
}

function planIncludes() {
  return [
    { model: Teacher, as: "teacher", include: [{ model: Department, as: "department" }] },
    { model: Class, as: "class", include: [{ model: Department, as: "department" }] },
    { model: Subject, as: "subject" },
    { model: LessonPlanFeedback, as: "feedback", order: [["createdAt", "DESC"]] },
  ];
}

async function getPlan(id) {
  return LessonPlan.findById(id, { include: planIncludes() });
}

function canView(plan, req) {
  return isReviewer(req) || (req.session.teacher && String(plan.teacherId) === String(req.session.teacher.id));
}

function canEdit(plan, req) {
  return !!(req.session.teacher &&
    String(plan.teacherId) === String(req.session.teacher.id) &&
    plan.status !== "approved");
}

async function getTeacherAssignments(teacherId) {
  return TeacherSubject.findAll({
    where: { teacherId },
    include: [
      { model: Class, as: "class", include: [{ model: Department, as: "department" }] },
      { model: Subject, as: "subject" },
    ],
    order: [["id", "ASC"]],
  });
}

router.use(requireLessonPlanAccess);

router.get("/", async (req, res) => {
  try {
    const where = isReviewer(req) ? {} : { teacherId: req.session.teacher.id };
    const plans = await LessonPlan.findAll({
      where,
      include: [
        { model: Teacher, as: "teacher" },
        { model: Class, as: "class", include: [{ model: Department, as: "department" }] },
        { model: Subject, as: "subject" },
      ],
      order: [["updatedAt", "DESC"]],
    });
    const departmentGroups = [];
    if (req.session.admin) {
      plans.forEach((plan) => {
        const department = plan.class && plan.class.department
          ? plan.class.department
          : plan.teacher && plan.teacher.department
          ? plan.teacher.department
          : { id: "unassigned", name: "Unassigned Department" };
        let group = departmentGroups.find((item) => String(item.id) === String(department.id));
        if (!group) {
          group = { id: department.id, name: department.name, plans: [] };
          departmentGroups.push(group);
        }
        group.plans.push(plan);
      });
      departmentGroups.sort((a, b) => a.name.localeCompare(b.name));
    }
    res.render(`${portal(req)}/lesson-plans`, {
      title: "Lesson Plans",
      plans,
      user: currentUser(req),
      teacher: req.session.teacher,
      admin: req.session.admin,
      isReviewer: isReviewer(req),
      departmentGroups,
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect(req.session.admin ? "/admin/dashboard" : "/teacher/dashboard");
  }
});

router.get("/new", async (req, res) => {
  if (!req.session.teacher) {
    req.flash("error", "Only teachers can create lesson plans.");
    return res.redirect("/teacher/lesson-plans");
  }
  try {
    const assignments = await getTeacherAssignments(req.session.teacher.id);
    const currentYear = await require("../models").AcademicYear.findOne({
      where: { isCurrent: true },
      include: [{ model: Term, as: "terms" }],
    });
    res.render("teacher/lesson-plan-form", {
      title: "Create Lesson Plan",
      assignments,
      terms: currentYear && currentYear.terms ? currentYear.terms : [],
      teacher: req.session.teacher,
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/teacher/lesson-plans");
  }
});

router.post("/save", async (req, res) => {
  if (!req.session.teacher) {
    req.flash("error", "Only teachers can create lesson plans.");
    return res.redirect("/teacher/lesson-plans");
  }
  try {
    const {
      classId, subjectId, periodType, startDate, endDate, term, academicYear, topic, subtitle,
      mainCompetence, keyConcepts, specificCompetence, essentialQuestions,
      formativeAssessment, summativeAssessment, lessonSteps, materials, assignment,
      differentiationStrategies, instructionalStrategies, objectiveTags,
    } = req.body;
    if (!classId || !subjectId || !periodType || !startDate || !endDate || !topic) {
      throw new Error("Class, subject, date range, and topic are required.");
    }
    if (!["day", "week", "term"].includes(periodType)) throw new Error("Invalid period type.");
    if (new Date(startDate) > new Date(endDate)) throw new Error("The end date must be on or after the start date.");
    const assigned = await TeacherSubject.findOne({
      where: { teacherId: req.session.teacher.id, classId: parseInt(classId, 10), subjectId: parseInt(subjectId, 10) },
    });
    if (!assigned) throw new Error("You may only create a plan for a class and subject assigned to you.");
    const selectedClass = await Class.findById(classId, {
      include: [{ model: Department, as: "department" }],
    });
    if (!selectedClass || !selectedClass.department) throw new Error("The selected class is not linked to a department.");
    await LessonPlan.create({
      teacherId: req.session.teacher.id,
      createdByTeacherId: req.session.teacher.id,
      classId: parseInt(classId, 10),
      subjectId: parseInt(subjectId, 10),
      periodType, startDate, endDate, term: term || null, academicYear: academicYear || null,
      topic: String(topic).trim(), subtitle: String(subtitle || "").trim() || null,
      mainCompetence: cleanRichText(mainCompetence), keyConcepts: cleanRichText(keyConcepts),
      specificCompetence: cleanRichText(specificCompetence), essentialQuestions: cleanRichText(essentialQuestions),
      formativeAssessment: cleanRichText(formativeAssessment), summativeAssessment: cleanRichText(summativeAssessment),
      lessonSteps: cleanRichText(lessonSteps), materials: cleanRichText(materials),
      assignment: cleanRichText(assignment), differentiationStrategies: cleanRichText(differentiationStrategies),
      instructionalStrategies: cleanRichText(instructionalStrategies),
      objectiveTags: JSON.stringify(parseTags(objectiveTags)),
    });
    req.flash("success", "Lesson plan submitted for review.");
    res.redirect("/teacher/lesson-plans");
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/teacher/lesson-plans/new");
  }
});

router.get("/:id/edit", async (req, res) => {
  if (!req.session.teacher) return res.redirect("/teacher/lesson-plans");
  try {
    const plan = await LessonPlan.findById(req.params.id);
    if (!plan || !canEdit(plan, req)) {
      req.flash("error", "Only your non-approved lesson plans can be edited.");
      return res.redirect(lessonPlanPath(req, req.params.id));
    }
    const currentYear = await require("../models").AcademicYear.findOne({
      where: { isCurrent: true },
      include: [{ model: Term, as: "terms" }],
    });
    res.render("teacher/lesson-plan-form", {
      title: "Edit Lesson Plan",
      plan: plan.toJSON(),
      tags: parseTags(plan.objectiveTags),
      assignments: await getTeacherAssignments(req.session.teacher.id),
      terms: currentYear && currentYear.terms ? currentYear.terms : [],
      teacher: req.session.teacher,
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect("/teacher/lesson-plans");
  }
});

router.post("/:id/update", async (req, res) => {
  if (!req.session.teacher) return res.redirect("/teacher/lesson-plans");
  try {
    const plan = await LessonPlan.findById(req.params.id);
    if (!plan || !canEdit(plan, req)) throw new Error("Only your non-approved lesson plans can be edited.");
    const {
      classId, subjectId, periodType, startDate, endDate, term, academicYear, topic, subtitle,
      mainCompetence, keyConcepts, specificCompetence, essentialQuestions,
      formativeAssessment, summativeAssessment, lessonSteps, materials, assignment,
      differentiationStrategies, instructionalStrategies, objectiveTags,
    } = req.body;
    if (!classId || !subjectId || !periodType || !startDate || !endDate || !topic) {
      throw new Error("Class, subject, date range, and topic are required.");
    }
    if (!["day", "week", "term"].includes(periodType)) throw new Error("Invalid period type.");
    if (new Date(startDate) > new Date(endDate)) throw new Error("The end date must be on or after the start date.");
    const assigned = await TeacherSubject.findOne({
      where: { teacherId: req.session.teacher.id, classId: parseInt(classId, 10), subjectId: parseInt(subjectId, 10) },
    });
    if (!assigned) throw new Error("You may only use a class and subject assigned to you.");
    const selectedClass = await Class.findById(classId, {
      include: [{ model: Department, as: "department" }],
    });
    if (!selectedClass || !selectedClass.department) throw new Error("The selected class is not linked to a department.");
    await plan.update({
      classId: parseInt(classId, 10),
      subjectId: parseInt(subjectId, 10),
      periodType, startDate, endDate, term: term || null, academicYear: academicYear || null,
      topic: String(topic).trim(), subtitle: String(subtitle || "").trim() || null,
      mainCompetence: cleanRichText(mainCompetence), keyConcepts: cleanRichText(keyConcepts),
      specificCompetence: cleanRichText(specificCompetence), essentialQuestions: cleanRichText(essentialQuestions),
      formativeAssessment: cleanRichText(formativeAssessment), summativeAssessment: cleanRichText(summativeAssessment),
      lessonSteps: cleanRichText(lessonSteps), materials: cleanRichText(materials),
      assignment: cleanRichText(assignment), differentiationStrategies: cleanRichText(differentiationStrategies),
      instructionalStrategies: cleanRichText(instructionalStrategies),
      objectiveTags: JSON.stringify(parseTags(objectiveTags)),
      status: "pending",
    });
    req.flash("success", "Lesson plan updated and returned to pending review.");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(lessonPlanPath(req, req.params.id));
});

router.post("/:id/delete", async (req, res) => {
  if (!req.session.teacher) return res.redirect("/teacher/lesson-plans");
  try {
    const plan = await LessonPlan.findById(req.params.id);
    if (!plan || !canEdit(plan, req)) throw new Error("Only your non-approved lesson plans can be deleted.");
    await LessonPlanFeedback.destroy({ where: { lessonPlanId: plan.id } });
    await plan.destroy();
    req.flash("success", "Lesson plan deleted.");
    return res.redirect("/teacher/lesson-plans");
  } catch (err) {
    req.flash("error", err.message);
    return res.redirect(lessonPlanPath(req, req.params.id));
  }
});

router.get("/:id", async (req, res) => {
  try {
    const plan = await getPlan(req.params.id);
    if (!plan || !canView(plan, req)) {
      req.flash("error", "Lesson plan not found or access denied.");
      return res.redirect(req.session.admin ? "/admin/lesson-plans" : "/teacher/lesson-plans");
    }
    const replacementTeachers = isReviewer(req)
      ? await Teacher.findAll({ where: { isActive: true }, order: [["fullName", "ASC"]] })
      : [];
    res.render(`${portal(req)}/lesson-plan-view`, {
      title: "LESSON PLAN",
      plan: plan.toJSON(),
      tags: parseTags(plan.objectiveTags),
      teacher: req.session.teacher,
      admin: req.session.admin,
      isReviewer: isReviewer(req),
      replacementTeachers,
      canEdit: canEdit(plan, req),
      portalBase: portalBase(req),
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect(lessonPlanPath(req, req.params.id));
  }
});

router.get("/:id/print", async (req, res) => {
  try {
    const plan = await getPlan(req.params.id);
    if (!plan || !canView(plan, req)) return res.status(403).send("Access denied");
    res.render("lesson-plan-print", { plan: plan.toJSON(), tags: parseTags(plan.objectiveTags) });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post("/:id/status", async (req, res) => {
  if (!isReviewer(req)) return res.status(403).send("Access denied");
  try {
    const plan = await LessonPlan.findById(req.params.id);
    if (!plan) throw new Error("Lesson plan not found.");
    if (!["pending", "approved", "returned"].includes(req.body.status)) throw new Error("Invalid status.");
    await plan.update({ status: req.body.status });
    req.flash("success", `Lesson plan marked ${req.body.status}.`);
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(lessonPlanPath(req, req.params.id));
});

router.post("/:id/feedback", async (req, res) => {
  if (!isReviewer(req)) return res.status(403).send("Access denied");
  try {
    const plan = await LessonPlan.findById(req.params.id);
    if (!plan) throw new Error("Lesson plan not found.");
    const comment = String(req.body.comment || "").trim();
    if (!comment) throw new Error("Feedback cannot be empty.");
    await LessonPlanFeedback.create({
      lessonPlanId: plan.id,
      authorName: req.session.admin ? req.session.admin.username : req.session.teacher.fullName,
      authorRole: req.session.admin ? "admin" : "academician",
      comment,
    });
    req.flash("success", "Feedback added.");
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(lessonPlanPath(req, req.params.id));
});

router.post("/:id/hand-over", async (req, res) => {
  if (!isReviewer(req)) return res.status(403).send("Access denied");
  try {
    const plan = await LessonPlan.findById(req.params.id);
    const teacher = await Teacher.findById(req.body.teacherId);
    if (!plan || !teacher) throw new Error("Lesson plan or replacement teacher not found.");
    await plan.update({ teacherId: teacher.id });
    req.flash("success", `Lesson plan handed over to ${teacher.fullName}.`);
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(lessonPlanPath(req, req.params.id));
});

module.exports = router;

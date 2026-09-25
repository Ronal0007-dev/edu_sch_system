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

function reviewerDepartmentId(req) {
  return req.session.teacher && req.session.teacher.role === "academician" ?
    req.session.teacher.departmentId :
    null;
}

function isReviewer(req) {
  return !!req.session.admin || (req.session.teacher && req.session.teacher.role === "academician");
}

function canReviewPlan(plan, req) {
  if (req.session.admin) return true;
  return !!(
    req.session.teacher &&
    req.session.teacher.role === "academician" &&
    String(plan.teacherId) !== String(req.session.teacher.id)
  );
}

function canAuthorLessonPlans(req) {
  return !!req.session.teacher;
}

function planDepartment(plan) {
  return plan.class && plan.class.department ?
    plan.class.department :
    plan.teacher && plan.teacher.department ?
    plan.teacher.department : {
      id: "unassigned",
      name: "Unassigned Department"
    };
}

function buildDepartmentTeacherGroups(plans, limit) {
  const departments = [];
  plans.forEach((plan) => {
    const department = planDepartment(plan);
    let departmentGroup = departments.find((item) => String(item.id) === String(department.id));
    if (!departmentGroup) {
      departmentGroup = {
        id: department.id,
        name: department.name,
        teachers: []
      };
      departments.push(departmentGroup);
    }
    const teacher = plan.teacher;
    if (!teacher) return;
    let teacherGroup = departmentGroup.teachers.find(
      (item) => String(item.id) === String(teacher.id),
    );
    if (!teacherGroup && departmentGroup.teachers.length < limit) {
      teacherGroup = {
        id: teacher.id,
        name: teacher.fullName,
        plans: []
      };
      departmentGroup.teachers.push(teacherGroup);
    }
    if (teacherGroup) teacherGroup.plans.push(plan);
  });
  return departments
    .filter((department) => department.teachers.length)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildTeacherClassGroups(plans, limit) {
  const classes = [];
  plans.forEach((plan) => {
    const lessonClass = plan.class || {
      id: "unassigned", name: "Unassigned Class"
    };
    let classGroup = classes.find(
      (item) => String(item.id) === String(lessonClass.id),
    );
    if (!classGroup) {
      classGroup = {
        id: lessonClass.id,
        name: lessonClass.name,
        plans: []
      };
      classes.push(classGroup);
    }
    if (classGroup.plans.length < limit) classGroup.plans.push(plan);
  });
  return classes.sort((a, b) => a.name.localeCompare(b.name));
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
  return [{
      model: Teacher,
      as: "teacher",
      include: [{
        model: Department,
        as: "department"
      }]
    },
    {
      model: Class,
      as: "class",
      include: [{
        model: Department,
        as: "department"
      }]
    },
    {
      model: Subject,
      as: "subject"
    },
    {
      model: LessonPlanFeedback,
      as: "feedback",
      order: [
        ["createdAt", "DESC"]
      ]
    },
  ];
}

async function getPlan(id) {
  return LessonPlan.findById(id, {
    include: planIncludes()
  });
}

function canView(plan, req) {
  if (req.session.admin) return true;
  if (req.session.teacher && req.session.teacher.role === "academician") {
    return String(planDepartment(plan).id) === String(req.session.teacher.departmentId);
  }
  return req.session.teacher && String(plan.teacherId) === String(req.session.teacher.id);
}

function canEdit(plan, req) {
  return !!(req.session.teacher &&
    String(plan.teacherId) === String(req.session.teacher.id) &&
    plan.status !== "approved");
}

async function getTeacherAssignments(teacherId) {
  return TeacherSubject.findAll({
    where: {
      teacherId
    },
    include: [{
        model: Class,
        as: "class",
        include: [{
          model: Department,
          as: "department"
        }]
      },
      {
        model: Subject,
        as: "subject"
      },
    ],
    order: [
      ["id", "ASC"]
    ],
  });
}

async function getAuthoringTeacher(req) {
  if (!req.session.teacher) return null;
  return Teacher.findById(req.session.teacher.id);
}

async function getLessonPlanAssignments(req) {
  const assignments = await getTeacherAssignments(req.session.teacher.id);
  const authoringTeacher = await getAuthoringTeacher(req);
  if (!authoringTeacher || authoringTeacher.role !== "academician") {
    return assignments;
  }
  const classes = await Class.findAll({
    where: {
      departmentId: authoringTeacher.departmentId
    },
    include: [{
        model: Department,
        as: "department"
      },
      {
        model: Subject,
        as: "subjects"
      },
    ],
    order: [
      ["name", "ASC"]
    ],
  });
  const departmentAssignments = classes.reduce((items, lessonClass) => {
    (lessonClass.subjects || []).forEach((subject) => {
      items.push({
        class: lessonClass,
        classId: lessonClass.id,
        subject,
        subjectId: subject.id
      });
    });
    return items;
  }, []);
  const assignmentKeys = {};
  return assignments.concat(departmentAssignments).filter((assignment) => {
    const key = `${assignment.classId}:${assignment.subjectId}`;
    if (assignmentKeys[key]) return false;
    assignmentKeys[key] = true;
    return true;
  });
}

async function canCreateLessonPlan(req, classId, subjectId) {
  const authoringTeacher = await getAuthoringTeacher(req);
  if (!authoringTeacher) return false;
  const parsedClassId = parseInt(classId, 10);
  const parsedSubjectId = parseInt(subjectId, 10);
  const assigned = await TeacherSubject.findOne({
    where: {
      teacherId: authoringTeacher.id,
      classId: parsedClassId,
      subjectId: parsedSubjectId,
    },
  });
  if (assigned) return true;
  if (authoringTeacher.role !== "academician") return false;
  const lessonClass = await Class.findById(parsedClassId, {
    include: [{
      model: Department,
      as: "department"
    }],
  });
  if (!lessonClass || String(lessonClass.departmentId) !== String(authoringTeacher.departmentId)) {
    return false;
  }
  const subject = await Subject.findOne({
    where: {
      id: parsedSubjectId,
      classId: parsedClassId
    },
  });
  return !!subject;
}

router.use(requireLessonPlanAccess);

router.get("/", async (req, res) => {
  try {
    const where = isReviewer(req) ? {} : {
      teacherId: req.session.teacher.id
    };
    const plans = await LessonPlan.findAll({
      where,
      include: [{
          model: Teacher,
          as: "teacher"
        },
        {
          model: Class,
          as: "class",
          include: [{
            model: Department,
            as: "department"
          }]
        },
        {
          model: Subject,
          as: "subject"
        },
      ],
      order: [
        ["updatedAt", "DESC"]
      ],
    });
    const departmentId = reviewerDepartmentId(req);
    const visiblePlans = departmentId ?
      plans.filter((plan) => String(planDepartment(plan).id) === String(departmentId)) :
      plans;
    const departmentGroups = isReviewer(req) ?
      buildDepartmentTeacherGroups(visiblePlans, 15) : [];
    res.render(`${portal(req)}/lesson-plans`, {
      title: "Lesson Plans",
      plans: visiblePlans,
      user: currentUser(req),
      teacher: req.session.teacher,
      admin: req.session.admin,
      isReviewer: isReviewer(req),
      departmentGroups,
      portalBase: portalBase(req),
      teacherDirectoryView: isReviewer(req),
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect(req.session.admin ? "/admin/dashboard" : "/teacher/dashboard");
  }
});

router.get("/teacher/:teacherId", async (req, res) => {
  if (!isReviewer(req)) {
    req.flash("error", "You are not allowed to view another teacher's lesson plans.");
    return res.redirect(`${portalBase(req)}/lesson-plans`);
  }
  try {
    const teacher = await Teacher.findById(req.params.teacherId, {
      include: [{
        model: Department,
        as: "department"
      }],
    });
    const departmentId = reviewerDepartmentId(req);
    if (!teacher || (departmentId && String(teacher.departmentId) !== String(departmentId))) {
      throw new Error("Teacher not found or outside your department.");
    }
    const plans = await LessonPlan.findAll({
      where: {
        teacherId: teacher.id
      },
      include: [{
          model: Teacher,
          as: "teacher"
        },
        {
          model: Class,
          as: "class",
          include: [{
            model: Department,
            as: "department"
          }]
        },
        {
          model: Subject,
          as: "subject"
        },
      ],
      order: [
        ["updatedAt", "DESC"]
      ],
    });
    const visiblePlans = departmentId ?
      plans.filter((plan) => String(planDepartment(plan).id) === String(departmentId)) :
      plans;
    const classGroups = buildTeacherClassGroups(visiblePlans, 10);
    res.render(`${portal(req)}/lesson-plans-by-teacher`, {
      title: "Teacher Lesson Plans",
      plans: visiblePlans,
      classGroups,
      selectedTeacher: teacher.toJSON(),
      teacher: req.session.teacher,
      admin: req.session.admin,
      isReviewer: true,
      portalBase: portalBase(req),
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect(`${portalBase(req)}/lesson-plans`);
  }
});

router.get("/new", async (req, res) => {
  if (!canAuthorLessonPlans(req)) {
    req.flash("error", "Only teachers and academicians can create lesson plans.");
    return res.redirect(`${portalBase(req)}/lesson-plans`);
  }
  try {
    const assignments = await getLessonPlanAssignments(req);
    const currentYear = await require("../models").AcademicYear.findOne({
      where: {
        isCurrent: true
      },
      include: [{
        model: Term,
        as: "terms"
      }],
    });
    res.render("teacher/lesson-plan-form", {
      title: "Create Lesson Plan",
      assignments,
      terms: currentYear && currentYear.terms ? currentYear.terms : [],
      teacher: req.session.teacher,
      portalBase: portalBase(req),
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect(`${portalBase(req)}/lesson-plans`);
  }
});

router.post("/save", async (req, res) => {
  if (!canAuthorLessonPlans(req)) {
    req.flash("error", "Only teachers and academicians can create lesson plans.");
    return res.redirect(`${portalBase(req)}/lesson-plans`);
  }
  try {
    const {
      classId,
      subjectId,
      periodType,
      startDate,
      endDate,
      term,
      academicYear,
      topic,
      subtitle,
      mainCompetence,
      keyConcepts,
      specificCompetence,
      essentialQuestions,
      formativeAssessment,
      summativeAssessment,
      lessonSteps,
      materials,
      assignment,
      differentiationStrategies,
      instructionalStrategies,
      objectiveTags,
    } = req.body;
    if (!classId || !subjectId || !periodType || !startDate || !endDate || !topic) {
      throw new Error("Class, subject, date range, and topic are required.");
    }
    if (!["day", "week", "term"].includes(periodType)) throw new Error("Invalid period type.");
    if (new Date(startDate) > new Date(endDate)) throw new Error("The end date must be on or after the start date.");
    if (!await canCreateLessonPlan(req, classId, subjectId)) {
      throw new Error("You may only create a plan for an assigned subject, or a subject in your department.");
    }
    const selectedClass = await Class.findById(classId, {
      include: [{
        model: Department,
        as: "department"
      }],
    });
    if (!selectedClass || !selectedClass.department) throw new Error("The selected class is not linked to a department.");
    await LessonPlan.create({
      teacherId: req.session.teacher.id,
      createdByTeacherId: req.session.teacher.id,
      classId: parseInt(classId, 10),
      subjectId: parseInt(subjectId, 10),
      periodType,
      startDate,
      endDate,
      term: term || null,
      academicYear: academicYear || null,
      topic: String(topic).trim(),
      subtitle: String(subtitle || "").trim() || null,
      mainCompetence: cleanRichText(mainCompetence),
      keyConcepts: cleanRichText(keyConcepts),
      specificCompetence: cleanRichText(specificCompetence),
      essentialQuestions: cleanRichText(essentialQuestions),
      formativeAssessment: cleanRichText(formativeAssessment),
      summativeAssessment: cleanRichText(summativeAssessment),
      lessonSteps: cleanRichText(lessonSteps),
      materials: cleanRichText(materials),
      assignment: cleanRichText(assignment),
      differentiationStrategies: cleanRichText(differentiationStrategies),
      instructionalStrategies: cleanRichText(instructionalStrategies),
      objectiveTags: JSON.stringify(parseTags(objectiveTags)),
    });
    req.flash("success", "Lesson plan submitted for review.");
    res.redirect(`${portalBase(req)}/lesson-plans`);
  } catch (err) {
    req.flash("error", err.message);
    res.redirect(`${portalBase(req)}/lesson-plans/new`);
  }
});

router.get("/:id/edit", async (req, res) => {
  if (!req.session.teacher) return res.redirect(`${portalBase(req)}/lesson-plans`);
  try {
    const plan = await LessonPlan.findById(req.params.id);
    if (!plan || !canEdit(plan, req)) {
      req.flash("error", "Only your non-approved lesson plans can be edited.");
      return res.redirect(lessonPlanPath(req, req.params.id));
    }
    const currentYear = await require("../models").AcademicYear.findOne({
      where: {
        isCurrent: true
      },
      include: [{
        model: Term,
        as: "terms"
      }],
    });
    res.render("teacher/lesson-plan-form", {
      title: "Edit Lesson Plan",
      plan: plan.toJSON(),
      tags: parseTags(plan.objectiveTags),
      assignments: await getLessonPlanAssignments(req),
      terms: currentYear && currentYear.terms ? currentYear.terms : [],
      teacher: req.session.teacher,
      portalBase: portalBase(req),
      error: req.flash("error"),
      success: req.flash("success"),
    });
  } catch (err) {
    req.flash("error", err.message);
    res.redirect(`${portalBase(req)}/lesson-plans`);
  }
});

router.post("/:id/update", async (req, res) => {
  if (!req.session.teacher) return res.redirect(`${portalBase(req)}/lesson-plans`);
  try {
    const plan = await LessonPlan.findById(req.params.id);
    if (!plan || !canEdit(plan, req)) throw new Error("Only your non-approved lesson plans can be edited.");
    const {
      classId,
      subjectId,
      periodType,
      startDate,
      endDate,
      term,
      academicYear,
      topic,
      subtitle,
      mainCompetence,
      keyConcepts,
      specificCompetence,
      essentialQuestions,
      formativeAssessment,
      summativeAssessment,
      lessonSteps,
      materials,
      assignment,
      differentiationStrategies,
      instructionalStrategies,
      objectiveTags,
    } = req.body;
    if (!classId || !subjectId || !periodType || !startDate || !endDate || !topic) {
      throw new Error("Class, subject, date range, and topic are required.");
    }
    if (!["day", "week", "term"].includes(periodType)) throw new Error("Invalid period type.");
    if (new Date(startDate) > new Date(endDate)) throw new Error("The end date must be on or after the start date.");
    if (!await canCreateLessonPlan(req, classId, subjectId)) {
      throw new Error("You may only use an assigned subject, or a subject in your department.");
    }
    const selectedClass = await Class.findById(classId, {
      include: [{
        model: Department,
        as: "department"
      }],
    });
    if (!selectedClass || !selectedClass.department) throw new Error("The selected class is not linked to a department.");
    await plan.update({
      classId: parseInt(classId, 10),
      subjectId: parseInt(subjectId, 10),
      periodType,
      startDate,
      endDate,
      term: term || null,
      academicYear: academicYear || null,
      topic: String(topic).trim(),
      subtitle: String(subtitle || "").trim() || null,
      mainCompetence: cleanRichText(mainCompetence),
      keyConcepts: cleanRichText(keyConcepts),
      specificCompetence: cleanRichText(specificCompetence),
      essentialQuestions: cleanRichText(essentialQuestions),
      formativeAssessment: cleanRichText(formativeAssessment),
      summativeAssessment: cleanRichText(summativeAssessment),
      lessonSteps: cleanRichText(lessonSteps),
      materials: cleanRichText(materials),
      assignment: cleanRichText(assignment),
      differentiationStrategies: cleanRichText(differentiationStrategies),
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
  if (!req.session.teacher) return res.redirect(`${portalBase(req)}/lesson-plans`);
  try {
    const plan = await LessonPlan.findById(req.params.id);
    if (!plan || !canEdit(plan, req)) throw new Error("Only your non-approved lesson plans can be deleted.");
    await LessonPlanFeedback.destroy({
      where: {
        lessonPlanId: plan.id
      }
    });
    await plan.destroy();
    req.flash("success", "Lesson plan deleted.");
    return res.redirect(`${portalBase(req)}/lesson-plans`);
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
      return res.redirect(`${portalBase(req)}/lesson-plans`);
    }
    const replacementTeachers = canReviewPlan(plan, req) ?
      await Teacher.findAll({
        where: Object.assign({
            isActive: true
          },
          reviewerDepartmentId(req) ? {
            departmentId: reviewerDepartmentId(req)
          } : {},
        ),
        order: [
          ["fullName", "ASC"]
        ],
      }) : [];
    res.render(`${portal(req)}/lesson-plan-view`, {
      title: "LESSON PLAN",
      plan: plan.toJSON(),
      tags: parseTags(plan.objectiveTags),
      teacher: req.session.teacher,
      admin: req.session.admin,
      isReviewer: isReviewer(req),
      canReviewPlan: canReviewPlan(plan, req),
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
    res.render("lesson-plan-print", {
      plan: plan.toJSON(),
      tags: parseTags(plan.objectiveTags)
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post("/:id/status", async (req, res) => {
  if (!isReviewer(req)) return res.status(403).send("Access denied");
  try {
    const plan = await getPlan(req.params.id);
    if (!plan || !canView(plan, req)) throw new Error("Lesson plan not found or access denied.");
    if (!canReviewPlan(plan, req)) throw new Error("Academicians cannot approve or change the status of their own lesson plan.");
    if (!["pending", "approved", "returned"].includes(req.body.status)) throw new Error("Invalid status.");
    await plan.update({
      status: req.body.status
    });
    req.flash("success", `Lesson plan marked ${req.body.status}.`);
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(lessonPlanPath(req, req.params.id));
});

router.post("/:id/feedback", async (req, res) => {
  if (!isReviewer(req)) return res.status(403).send("Access denied");
  try {
    const plan = await getPlan(req.params.id);
    if (!plan || !canView(plan, req)) throw new Error("Lesson plan not found or access denied.");
    if (!canReviewPlan(plan, req)) throw new Error("Academicians cannot review their own lesson plan.");
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
    const plan = await getPlan(req.params.id);
    const teacher = await Teacher.findById(req.body.teacherId);
    if (!plan || !canView(plan, req) || !teacher) {
      throw new Error("Lesson plan or replacement teacher not found.");
    }
    if (!canReviewPlan(plan, req)) throw new Error("Academicians cannot review their own lesson plan.");
    const departmentId = reviewerDepartmentId(req);
    if (departmentId && String(teacher.departmentId) !== String(departmentId)) {
      throw new Error("The replacement teacher must belong to your department.");
    }
    await plan.update({
      teacherId: teacher.id
    });
    req.flash("success", `Lesson plan handed over to ${teacher.fullName}.`);
  } catch (err) {
    req.flash("error", err.message);
  }
  res.redirect(lessonPlanPath(req, req.params.id));
});

module.exports = router;

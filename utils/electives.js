const {
  StudentSubject,
  Class,
  Department,
  TeacherSubject,
  TeacherClass,
} = require("../models");

// Year 11 (Secondary) students only have Mathematics and English as compulsory subjects.
function isElectiveClass(cls) {
  return Boolean(
    cls &&
    /^year\s*11\b/i.test(String(cls.name || "").trim()) &&
    cls.department &&
    String(cls.department.code || "").toLowerCase() === "secondary",
  );
}

function isCompulsorySubject(subject) {
  return /^(english|mathematics|maths?)(\s+language)?$/i.test(
    String((subject && subject.name) || "").trim(),
  );
}

// Checks if a teacher is currently assigned to teach Year 11 in Secondary department.
async function teacherTeachesYear11(teacherId) {
  if (!teacherId) return false;
  const classes = await Class.findAll({
    include: [{ model: Department, as: "department" }],
  });
  const year11ClassIds = classes.filter(isElectiveClass).map((c) => c.id);
  if (!year11ClassIds.length) return false;

  const [tsCount, tcCount] = await Promise.all([
    TeacherSubject.count({ where: { teacherId, classId: { $in: year11ClassIds } } }),
    TeacherClass.count({ where: { teacherId, classId: { $in: year11ClassIds } } }),
  ]);
  return tsCount > 0 || tcCount > 0;
}

// Keeps compulsory subjects plus the optional subjects the student opted to take.
async function filterMarksForStudent(student, marks) {
  if (!student || !isElectiveClass(student.class)) return marks;
  const rows = await StudentSubject.findAll({ where: { studentId: student.id } });
  const chosen = new Set(rows.map((row) => Number(row.subjectId)));
  return marks.filter(
    (mark) => mark.subject && (isCompulsorySubject(mark.subject) || chosen.has(Number(mark.subjectId))),
  );
}

// For marks entry: Year 11 optional subjects list only the students who opted for them.
async function filterStudentsForSubject(students, cls, subject) {
  if (!isElectiveClass(cls) || !subject || isCompulsorySubject(subject)) return students;
  const rows = await StudentSubject.findAll({ where: { subjectId: subject.id } });
  const opted = new Set(rows.map((row) => Number(row.studentId)));
  return students.filter((student) => opted.has(Number(student.id)));
}

module.exports = {
  isElectiveClass,
  isCompulsorySubject,
  teacherTeachesYear11,
  filterMarksForStudent,
  filterStudentsForSubject,
};

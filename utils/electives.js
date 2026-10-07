const { StudentSubject } = require("../models");

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

module.exports = { isElectiveClass, isCompulsorySubject, filterMarksForStudent, filterStudentsForSubject };

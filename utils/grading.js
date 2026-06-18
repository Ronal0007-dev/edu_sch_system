/**
 * CONTINUOUS ASSESSMENT (CA) — excludes Final Exam
 * Weighted: 10%HW + 15%GW + 20%QZ + 20%CW + 35%UT  (total = 100%)
 * Unweighted: average of HW, GW, QZ, CW, UT (5 components)
 */
exports.calculateScore = (marks, method) => {
  const { homework, groupWork, quiz, classWork, unitTest } = marks;
  if (method === 'weighted') {
    return (
      (homework  * 0.10) +
      (groupWork * 0.15) +
      (quiz      * 0.20) +
      (classWork * 0.20) +
      (unitTest  * 0.35)
    );
  }
  return (homework + groupWork + quiz + classWork + unitTest) / 5;
};

exports.getGrade = (score) => {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
};

exports.getRemark = (grade) => {
  const map = { A: 'Excellent', B: 'Very Good', C: 'Good', D: 'Satisfactory', F: 'Fail' };
  return map[grade] || 'N/A';
};
exports.getGradeRemark = exports.getRemark;

/**
 * PRIMARY Final Exam — out of 50
 * 41-50 Outstanding | 31-40 High | 21-30 Good | 11-20 Aspiring | 1-10 Basic | 0 Unclassified
 */
exports.getPrimaryExamGrade = (score) => {
  const s = parseFloat(score) || 0;
  if (s === 0)  return { grade: 'U',  label: 'Unclassified' };
  if (s <= 10)  return { grade: 'B',  label: 'Basic' };
  if (s <= 20)  return { grade: 'As', label: 'Aspiring' };
  if (s <= 30)  return { grade: 'G',  label: 'Good' };
  if (s <= 40)  return { grade: 'H',  label: 'High' };
  return              { grade: 'O',  label: 'Outstanding' };
};

/** PRIMARY pass threshold: >= 21 out of 50 */
exports.primaryExamPassed = (score) => parseFloat(score) >= 21;

/**
 * SECONDARY Final Exam — out of teacher-set max.
 * Pass = >= 40% of max mark.
 */
exports.secondaryExamPassed = (score, maxMark) => {
  if (!maxMark || maxMark <= 0) return false;
  return (parseFloat(score) / parseFloat(maxMark)) * 100 >= 40;
};

/**
 * Build analysis for a class — Final Exam pass/fail per subject
 * marks = array of Mark plain objects (with subject, student included)
 */
exports.buildExamAnalysis = (marks, deptCode) => {
  const isPrimary = deptCode === 'Primary' || deptCode === 'EYC';
  // group by subject
  const bySubject = {};
  marks.forEach(m => {
    const sid = m.subjectId;
    if (!bySubject[sid]) bySubject[sid] = { subject: m.subject, marks: [] };
    bySubject[sid].marks.push(m);
  });

  return Object.values(bySubject).map(({ subject, marks: sMarks }) => {
    const pass = sMarks.filter(m => {
      if (isPrimary) return exports.primaryExamPassed(m.finalExam);
      return exports.secondaryExamPassed(m.finalExam, m.finalExamMax);
    });
    const fail = sMarks.filter(m => {
      if (isPrimary) return !exports.primaryExamPassed(m.finalExam);
      return !exports.secondaryExamPassed(m.finalExam, m.finalExamMax);
    });
    return { subject, total: sMarks.length, pass: pass.length, fail: fail.length, marks: sMarks };
  });
};

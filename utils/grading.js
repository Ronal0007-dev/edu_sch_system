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

/** PRIMARY pass threshold: >= 50% (>= 25 out of 50) */
exports.primaryExamPassed = (score, maxMark = 50) => {
  const s = parseFloat(score) || 0;
  const max = parseFloat(maxMark) || 50;
  return max > 0 ? (s / max) * 100 >= 50 : s >= 25;
};

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
      if (isPrimary) return exports.primaryExamPassed(m.finalExam, m.finalExamMax || 50);
      return exports.secondaryExamPassed(m.finalExam, m.finalExamMax);
    });
    const fail = sMarks.filter(m => {
      if (isPrimary) return !exports.primaryExamPassed(m.finalExam, m.finalExamMax || 50);
      return !exports.secondaryExamPassed(m.finalExam, m.finalExamMax);
    });
    return { subject, total: sMarks.length, pass: pass.length, fail: fail.length, marks: sMarks };
  });
};

/**
 * Helper to check if subject name matches Art & Design
 */
function isArtSubject(subjectName) {
  if (!subjectName) return false;
  const sNorm = subjectName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return sNorm === 'artdesign' || sNorm === 'artanddesign' || sNorm === 'art';
}
exports.isArtSubject = isArtSubject;

/**
 * Check if a class is in Primary department (Stage 1 to 6 / Primary / EYC)
 */
function isPrimaryClass(className, deptCode) {
  const dNorm = String(deptCode || '').trim().toLowerCase();
  if (dNorm === 'primary' || dNorm === 'eyc') return true;
  const cNorm = String(className || '').trim().toLowerCase();
  return /^stage\s*[1-6]\b/i.test(cNorm);
}
exports.isPrimaryClass = isPrimaryClass;

/**
 * Parse score input. A dash (-) represents that student did not sit for assessment and is treated as 0.
 */
function parseScoreInput(val) {
  if (val === null || val === undefined) return 0;
  const s = String(val).trim();
  if (s === '' || s === '-') return 0;
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}
exports.parseScoreInput = parseScoreInput;

/**
 * ART & DESIGN (Year 10 & Year 11 Secondary) — CA out of 72.
 * No weighting, no averaging: raw summation of all 5 components, max 72.
 * Pass threshold: >= 40% of 72 = >= 28.8 (rounded to >= 29).
 */
const ART_MAX = 72;
exports.ART_MAX = ART_MAX;

function isArtDesignSenior(subjectName, className, deptCode) {
  if (!isArtSubject(subjectName)) return false;
  const cNorm = (className || '').trim().toLowerCase().replace(/\s+/g, '');
  const isSenior = /^year(10|11)/i.test(cNorm);
  const isSecondary = String(deptCode || '').trim().toLowerCase() === 'secondary';
  return isSenior && isSecondary;
}
exports.isArtDesignSenior = isArtDesignSenior;

/**
 * ART & DESIGN (Year 7, Year 8, Year 9 Secondary) — Average of assessments (Sum / 5).
 * Summation of components and find average (NOT weighted). Dash (-) counts as 0.
 */
function isArtDesignJunior(subjectName, className, deptCode) {
  if (!isArtSubject(subjectName)) return false;
  const cNorm = (className || '').trim().toLowerCase().replace(/\s+/g, '');
  const isJunior = /^year[789]/i.test(cNorm);
  const isSecondary = String(deptCode || '').trim().toLowerCase() === 'secondary';
  return isJunior && isSecondary;
}
exports.isArtDesignJunior = isArtDesignJunior;

/**
 * ART & DESIGN (Primary department — Stage 1 to 6, Primary, EYC).
 * Summation of all marks to total 100, pass mark 50.
 * Score obtained is converted to 50% for Final Exam (out of 50).
 */
function isArtDesignPrimary(subjectName, className, deptCode) {
  if (!isArtSubject(subjectName)) return false;
  return isPrimaryClass(className, deptCode);
}
exports.isArtDesignPrimary = isArtDesignPrimary;

// Backward-compatible alias: refers to the out-of-72 summation mode (Year 10 & 11)
exports.isArtDesignSubject = function(subjectName, className, deptCode) {
  return isArtDesignSenior(subjectName, className, deptCode);
};

exports.calculateArtScore = function(marks) {
  return parseScoreInput(marks.homework)
       + parseScoreInput(marks.groupWork)
       + parseScoreInput(marks.quiz)
       + parseScoreInput(marks.classWork)
       + parseScoreInput(marks.unitTest);
};

exports.calculateArtJuniorScore = function(marks) {
  const hw = parseScoreInput(marks.homework);
  const gw = parseScoreInput(marks.groupWork);
  const qz = parseScoreInput(marks.quiz);
  const cw = parseScoreInput(marks.classWork);
  const ut = parseScoreInput(marks.unitTest);
  const sum = hw + gw + qz + cw + ut;
  const average = Math.round((sum / 5) * 10) / 10;
  return { sum, average };
};

exports.calculatePrimaryScore = function(marks) {
  const hw = parseScoreInput(marks.homework);
  const gw = parseScoreInput(marks.groupWork);
  const qz = parseScoreInput(marks.quiz);
  const cw = parseScoreInput(marks.classWork);
  const ut = parseScoreInput(marks.unitTest);
  return Math.round((hw + gw + qz + cw + ut) * 10) / 10;
};

exports.getPrimaryCAGrade = function(score) {
  const s = parseFloat(score) || 0;
  if (s >= 90) return 'A';
  if (s >= 80) return 'B';
  if (s >= 70) return 'C';
  if (s >= 50) return 'D';
  return 'F';
};

exports.artGrade = function(total) {
  // Pass threshold: >= 40% of 72 = >= 28.8 → round to >= 29
  return total >= Math.ceil(ART_MAX * 0.4) ? 'Pass' : 'Fail';
};

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
 * SECONDARY DEPARTMENT (Year 7 - Year 9) Final Exam Remark Generator
 */
exports.getSecondaryJuniorRemark = (subjectName, score) => {
  const s = parseFloat(score);
  if (isNaN(s)) return 'Unclassified';

  const normSubject = String(subjectName || '').trim().toLowerCase();

  // Languages: English, English Literature, Swahili, French
  const langSubjects = ['english', 'english literature', 'swahili', 'french'];
  if (langSubjects.includes(normSubject)) {
    if (s >= 49 && s <= 70) return 'S4';
    if (s >= 42 && s <= 48) return 'S3';
    if (s >= 29 && s <= 41) return 'S2';
    if (s >= 21 && s <= 28) return 'S1';
    return 'Unclassified';
  }

  // Core / Other Subjects: Mathematics, Computing, Science, History, Geography, Religious Studies, Accounting, Art & Design
  const otherSubjects = [
    'mathematics', 'computing', 'science', 'history', 
    'geography', 'religious studies', 'accounting', 'art & design'
  ];
  if (otherSubjects.includes(normSubject)) {
    if (s >= 64 && s <= 80) return 'S4';
    if (s >= 50 && s <= 63) return 'S3';
    if (s >= 27 && s <= 49) return 'S2';
    if (s >= 13 && s <= 26) return 'S1';
    return 'Unclassified';
  }

  return 'Unclassified';
};

/**
 * SECONDARY DEPARTMENT (Year 10 - Year 11) Final Exam Remark Generator
 * Grades: 9 to 1, or U (Unclassified)
 */
exports.getSecondarySeniorRemark = (subjectName, score) => {
  const s = parseFloat(score);
  if (isNaN(s)) return 'U';

  const norm = String(subjectName || '').trim().toLowerCase().replace(/[^a-z0-9&]/g, '');

  // Swahili
  if (norm.includes('swahili')) {
    if (s >= 101 && s <= 120) return '9';
    if (s >= 94  && s <= 100) return '8';
    if (s >= 88  && s <= 93)  return '7';
    if (s >= 77  && s <= 87)  return '6';
    if (s >= 66  && s <= 76)  return '5';
    if (s >= 56  && s <= 65)  return '4';
    if (s >= 46  && s <= 55)  return '3';
    if (s >= 36  && s <= 45)  return '2';
    if (s >= 27  && s <= 35)  return '1';
    return 'U';
  }

  // Religious Studies
  if (norm.includes('religious') || norm.includes('rs')) {
    if (s >= 115 && s <= 167) return '9';
    if (s >= 106 && s <= 114) return '8';
    if (s >= 98  && s <= 105) return '7';
    if (s >= 89  && s <= 97)  return '6';
    if (s >= 81  && s <= 88)  return '5';
    if (s >= 73  && s <= 80)  return '4';
    if (s >= 61  && s <= 72)  return '3';
    if (s >= 49  && s <= 60)  return '2';
    if (s >= 37  && s <= 48)  return '1';
    return 'U';
  }

  // Physics
  if (norm.includes('physics')) {
    if (s >= 138 && s <= 180) return '9';
    if (s >= 121 && s <= 137) return '8';
    if (s >= 105 && s <= 120) return '7';
    if (s >= 94  && s <= 104) return '6';
    if (s >= 83  && s <= 93)  return '5';
    if (s >= 72  && s <= 82)  return '4';
    if (s >= 60  && s <= 71)  return '3';
    if (s >= 49  && s <= 59)  return '2';
    if (s >= 38  && s <= 48)  return '1';
    return 'U';
  }

  // Mathematics
  if (norm.includes('math')) {
    if (s >= 172 && s <= 200) return '9';
    if (s >= 144 && s <= 171) return '8';
    if (s >= 118 && s <= 143) return '7';
    if (s >= 92  && s <= 117) return '6';
    if (s >= 68  && s <= 91)  return '5';
    if (s >= 44  && s <= 67)  return '4';
    if (s >= 32  && s <= 43)  return '3';
    return 'U';
  }

  // ICT / Computing
  if (norm.includes('ict') || norm.includes('computing')) {
    if (s >= 153 && s <= 200) return '9';
    if (s >= 139 && s <= 152) return '8';
    if (s >= 125 && s <= 138) return '7';
    if (s >= 109 && s <= 124) return '6';
    if (s >= 93  && s <= 108) return '5';
    if (s >= 78  && s <= 92)  return '4';
    if (s >= 60  && s <= 77)  return '3';
    if (s >= 42  && s <= 59)  return '2';
    if (s >= 24  && s <= 41)  return '1';
    return 'U';
  }

  // History
  if (norm.includes('history')) {
    if (s >= 99 && s <= 120) return '9';
    if (s >= 91 && s <= 98)  return '8';
    if (s >= 83 && s <= 90)  return '7';
    if (s >= 74 && s <= 82)  return '6';
    if (s >= 66 && s <= 73)  return '5';
    if (s >= 58 && s <= 65)  return '4';
    if (s >= 43 && s <= 57)  return '3';
    if (s >= 28 && s <= 42)  return '2';
    if (s >= 14 && s <= 27)  return '1';
    return 'U';
  }

  // Geography
  if (norm.includes('geography')) {
    if (s >= 138 && s <= 175) return '9';
    if (s >= 126 && s <= 137) return '8';
    if (s >= 114 && s <= 125) return '7';
    if (s >= 100 && s <= 113) return '6';
    if (s >= 87  && s <= 99)  return '5';
    if (s >= 74  && s <= 86)  return '4';
    if (s >= 59  && s <= 73)  return '3';
    if (s >= 44  && s <= 58)  return '2';
    if (s >= 29  && s <= 43)  return '1';
    return 'U';
  }

  // English Literature
  if (norm.includes('literature')) {
    if (s >= 121 && s <= 150) return '9';
    if (s >= 113 && s <= 120) return '8';
    if (s >= 106 && s <= 112) return '7';
    if (s >= 93  && s <= 105) return '6';
    if (s >= 81  && s <= 92)  return '5';
    if (s >= 69  && s <= 80)  return '4';
    if (s >= 52  && s <= 68)  return '3';
    if (s >= 36  && s <= 51)  return '2';
    if (s >= 20  && s <= 35)  return '1';
    return 'U';
  }

  // English
  if (norm.includes('english')) {
    if (s >= 113 && s <= 150) return '9';
    if (s >= 105 && s <= 112) return '8';
    if (s >= 98  && s <= 104) return '7';
    if (s >= 88  && s <= 97)  return '6';
    if (s >= 78  && s <= 87)  return '5';
    if (s >= 69  && s <= 77)  return '4';
    if (s >= 51  && s <= 68)  return '3';
    if (s >= 34  && s <= 50)  return '2';
    if (s >= 17  && s <= 33)  return '1';
    return 'U';
  }

  // Chemistry
  if (norm.includes('chemistry')) {
    if (s >= 141 && s <= 180) return '9';
    if (s >= 122 && s <= 140) return '8';
    if (s >= 103 && s <= 121) return '7';
    if (s >= 90  && s <= 102) return '6';
    if (s >= 78  && s <= 89)  return '5';
    if (s >= 66  && s <= 77)  return '4';
    if (s >= 53  && s <= 65)  return '3';
    if (s >= 41  && s <= 52)  return '2';
    if (s >= 29  && s <= 40)  return '1';
    return 'U';
  }

  // Biology
  if (norm.includes('biology')) {
    if (s >= 142 && s <= 180) return '9';
    if (s >= 127 && s <= 141) return '8';
    if (s >= 112 && s <= 126) return '7';
    if (s >= 97  && s <= 111) return '6';
    if (s >= 82  && s <= 96)  return '5';
    if (s >= 67  && s <= 81)  return '4';
    if (s >= 55  && s <= 66)  return '3';
    if (s >= 43  && s <= 54)  return '2';
    if (s >= 32  && s <= 42)  return '1';
    return 'U';
  }

  // Art & Design
  if (norm.includes('art') || norm.includes('design')) {
    if (s >= 122 && s <= 144) return '9';
    if (s >= 112 && s <= 121) return '8';
    if (s >= 102 && s <= 111) return '7';
    if (s >= 90  && s <= 101) return '6';
    if (s >= 79  && s <= 89)  return '5';
    if (s >= 68  && s <= 78)  return '4';
    if (s >= 53  && s <= 67)  return '3';
    if (s >= 38  && s <= 52)  return '2';
    if (s >= 24  && s <= 37)  return '1';
    return 'U';
  }

  return 'U';
};

exports.buildExamAnalysis = (marks, deptCode) => {
  const isPrimary = deptCode === 'Primary' || deptCode === 'EYC';
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

function isArtSubject(subjectName) {
  if (!subjectName) return false;
  const sNorm = subjectName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return sNorm === 'artdesign' || sNorm === 'artanddesign' || sNorm === 'art';
}
exports.isArtSubject = isArtSubject;

function isPrimaryClass(className, deptCode) {
  const dNorm = String(deptCode || '').trim().toLowerCase();
  if (dNorm === 'primary' || dNorm === 'eyc') return true;
  const cNorm = String(className || '').trim().toLowerCase();
  return /^stage\s*[1-6]\b/i.test(cNorm);
}
exports.isPrimaryClass = isPrimaryClass;

function parseScoreInput(val) {
  if (val === null || val === undefined) return 0;
  const s = String(val).trim();
  if (s === '' || s === '-') return 0;
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}
exports.parseScoreInput = parseScoreInput;

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

function isArtDesignJunior(subjectName, className, deptCode) {
  if (!isArtSubject(subjectName)) return false;
  const cNorm = (className || '').trim().toLowerCase().replace(/\s+/g, '');
  const isJunior = /^year[789]/i.test(cNorm);
  const isSecondary = String(deptCode || '').trim().toLowerCase() === 'secondary';
  return isJunior && isSecondary;
}
exports.isArtDesignJunior = isArtDesignJunior;

function isArtDesignPrimary(subjectName, className, deptCode) {
  if (!isArtSubject(subjectName)) return false;
  return isPrimaryClass(className, deptCode);
}
exports.isArtDesignPrimary = isArtDesignPrimary;

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
  return total >= Math.ceil(ART_MAX * 0.4) ? 'Pass' : 'Fail';
};
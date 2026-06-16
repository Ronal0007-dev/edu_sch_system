/**
 * Calculate total score based on grading method
 * Weighted: 5%HW + 10%GW + 15%QZ + 15%CW + 25%UT + 30%FE
 * Unweighted: average of all 6 components
 */
exports.calculateScore = (marks, method) => {
  const { homework, classWork, groupWork, quiz, unitTest, finalExam } = marks;
  if (method === 'weighted') {
    return (
      (homework * 0.05) +
      (classWork * 0.15) +
      (groupWork * 0.10) +
      (quiz * 0.15) +
      (unitTest * 0.25) +
      (finalExam * 0.30)
    );
  } else {
    return (homework + classWork + groupWork + quiz + unitTest + finalExam) / 6;
  }
};

exports.getGrade = (score) => {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
};

exports.getGradeClass = (grade) => {
  const map = { A: 'grade-a', B: 'grade-b', C: 'grade-c', D: 'grade-d', F: 'grade-f' };
  return map[grade] || '';
};

exports.getRemark = (grade) => {
  const map = { A: 'Excellent', B: 'Very Good', C: 'Good', D: 'Satisfactory', F: 'Fail' };
  return map[grade] || 'N/A';
};

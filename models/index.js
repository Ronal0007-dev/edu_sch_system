const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const bcrypt = require('bcryptjs');

// ─── Department ───────────────────────────────────────────────────────────────
const Department = sequelize.define('Department', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  code: { type: DataTypes.ENUM('EYC', 'Primary', 'Secondary'), allowNull: false, unique: true }
}, { tableName: 'departments', timestamps: true });

// ─── Teacher ──────────────────────────────────────────────────────────────────
const Teacher = sequelize.define('Teacher', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  fullName: { type: DataTypes.STRING(100), allowNull: false },
  phone: { type: DataTypes.STRING(20), allowNull: false, unique: true },
  email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255), allowNull: false },
  role: { type: DataTypes.ENUM('teacher', 'class_teacher', 'head_of_dept', 'admin'), defaultValue: 'teacher' },
  departmentId: { type: DataTypes.INTEGER, allowNull: false },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  mustChangePassword: { type: DataTypes.BOOLEAN, defaultValue: true },
  resetToken: { type: DataTypes.STRING(255), allowNull: true },
  resetTokenExpiry: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'teachers', timestamps: true });

Teacher.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// ─── Admin ────────────────────────────────────────────────────────────────────
const Admin = sequelize.define('Admin', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  password: { type: DataTypes.STRING(255), allowNull: false },
  email: { type: DataTypes.STRING(100) }
}, { tableName: 'admins', timestamps: true });

Admin.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// ─── Academic Year ─────────────────────────────────────────────────────────────
const AcademicYear = sequelize.define('AcademicYear', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(20), allowNull: false, unique: true },
  startDate: { type: DataTypes.DATEONLY, allowNull: false },
  endDate: { type: DataTypes.DATEONLY, allowNull: false },
  isCurrent: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'academic_years', timestamps: true });

// ─── Term ─────────────────────────────────────────────────────────────────────
const Term = sequelize.define('Term', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  academicYearId: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.ENUM('Term 1', 'Term 2', 'Term 3'), allowNull: false },
  startDate: { type: DataTypes.DATEONLY, allowNull: false },
  endDate: { type: DataTypes.DATEONLY, allowNull: false },
  isOpen: { type: DataTypes.BOOLEAN, defaultValue: true }
}, { tableName: 'terms', timestamps: true });

// ─── Class ────────────────────────────────────────────────────────────────────
const Class = sequelize.define('Class', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(50), allowNull: false },
  departmentId: { type: DataTypes.INTEGER, allowNull: false }
}, { tableName: 'classes', timestamps: true });

// ─── Stream ───────────────────────────────────────────────────────────────────
const Stream = sequelize.define('Stream', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(50), allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false }
}, { tableName: 'streams', timestamps: true });

// ─── Subject ──────────────────────────────────────────────────────────────────
const Subject = sequelize.define('Subject', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false }
}, { tableName: 'subjects', timestamps: true });

// ─── Student ──────────────────────────────────────────────────────────────────
const Student = sequelize.define('Student', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  fullName: { type: DataTypes.STRING(100), allowNull: false },
  gender: { type: DataTypes.ENUM('Male', 'Female'), allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false },
  streamId: { type: DataTypes.INTEGER },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
}, { tableName: 'students', timestamps: true });

// ─── Teacher-Class Assignment ─────────────────────────────────────────────────
const TeacherClass = sequelize.define('TeacherClass', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  teacherId: { type: DataTypes.INTEGER, allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false },
  isClassTeacher: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'teacher_classes', timestamps: true });

// ─── Report Comment ───────────────────────────────────────────────────────────
const ReportComment = sequelize.define('ReportComment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  studentId: { type: DataTypes.INTEGER, allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false },
  teacherId: { type: DataTypes.INTEGER, allowNull: false },
  term: { type: DataTypes.ENUM('Term 1', 'Term 2', 'Term 3'), allowNull: false },
  academicYear: { type: DataTypes.STRING(9), allowNull: false },
  comment: { type: DataTypes.TEXT, allowNull: false }
}, {
  tableName: 'report_comments',
  timestamps: true,
  indexes: [{ unique: true, fields: ['studentId', 'classId', 'term', 'academicYear'] }]
});

// ─── Teacher-Subject Assignment ───────────────────────────────────────────────
const TeacherSubject = sequelize.define('TeacherSubject', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  teacherId: { type: DataTypes.INTEGER, allowNull: false },
  subjectId: { type: DataTypes.INTEGER, allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false }
}, { tableName: 'teacher_subjects', timestamps: true });

// ─── Class-Subject Assignment ─────────────────────────────────────────────────
const ClassSubject = sequelize.define('ClassSubject', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  classId: { type: DataTypes.INTEGER, allowNull: false },
  subjectId: { type: DataTypes.INTEGER, allowNull: false }
}, { tableName: 'class_subjects', timestamps: true });

// ─── Public Holiday ───────────────────────────────────────────────────────────
const PublicHoliday = sequelize.define('PublicHoliday', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false, unique: true }
}, { tableName: 'public_holidays', timestamps: true });

// ─── Attendance ───────────────────────────────────────────────────────────────
const Attendance = sequelize.define('Attendance', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  studentId: { type: DataTypes.INTEGER, allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.ENUM('present', 'absent', 'sick'), allowNull: false },
  takenBy: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: 'attendance',
  timestamps: true,
  indexes: [{ unique: true, fields: ['studentId', 'classId', 'date'] }]
});

// ─── Marks ────────────────────────────────────────────────────────────────────
const Mark = sequelize.define('Mark', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  studentId: { type: DataTypes.INTEGER, allowNull: false },
  subjectId: { type: DataTypes.INTEGER, allowNull: false },
  classId: { type: DataTypes.INTEGER, allowNull: false },
  term: { type: DataTypes.ENUM('Term 1', 'Term 2', 'Term 3'), allowNull: false },
  academicYear: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '2024/2025' },
  homework: { type: DataTypes.FLOAT, defaultValue: 0 },
  groupWork: { type: DataTypes.FLOAT, defaultValue: 0 },
  quiz: { type: DataTypes.FLOAT, defaultValue: 0 },
  classWork: { type: DataTypes.FLOAT, defaultValue: 0 },
  unitTest: { type: DataTypes.FLOAT, defaultValue: 0 },
  finalExam: { type: DataTypes.FLOAT, defaultValue: 0 },
  gradingMethod: { type: DataTypes.ENUM('weighted', 'unweighted'), defaultValue: 'weighted' },
  totalScore: { type: DataTypes.FLOAT },
  grade: { type: DataTypes.STRING(2) },
  enteredBy: { type: DataTypes.INTEGER }
}, {
  tableName: 'marks',
  timestamps: true,
  indexes: [{ unique: true, fields: ['studentId', 'subjectId', 'classId', 'term', 'academicYear'] }]
});

// ─── Associations ─────────────────────────────────────────────────────────────
AcademicYear.hasMany(Term, { foreignKey: 'academicYearId', as: 'terms' });
Term.belongsTo(AcademicYear, { foreignKey: 'academicYearId', as: 'academicYear' });

Department.hasMany(Teacher, { foreignKey: 'departmentId', as: 'teachers' });
Teacher.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

Department.hasMany(Class, { foreignKey: 'departmentId', as: 'classes' });
Class.belongsTo(Department, { foreignKey: 'departmentId', as: 'department' });

Class.hasMany(Stream, { foreignKey: 'classId', as: 'streams' });
Stream.belongsTo(Class, { foreignKey: 'classId', as: 'class' });

Class.hasMany(Subject, { foreignKey: 'classId', as: 'subjects' });
Subject.belongsTo(Class, { foreignKey: 'classId', as: 'class' });

Class.hasMany(Student, { foreignKey: 'classId', as: 'students' });
Student.belongsTo(Class, { foreignKey: 'classId', as: 'class' });

Stream.hasMany(Student, { foreignKey: 'streamId', as: 'students' });
Student.belongsTo(Stream, { foreignKey: 'streamId', as: 'stream' });

Teacher.belongsToMany(Class, { through: TeacherClass, foreignKey: 'teacherId', as: 'classes' });
Class.belongsToMany(Teacher, { through: TeacherClass, foreignKey: 'classId', as: 'teachers' });

Subject.belongsToMany(Class, { through: ClassSubject, foreignKey: 'subjectId', as: 'assignedClasses' });
Class.belongsToMany(Subject, { through: ClassSubject, foreignKey: 'classId', as: 'assignedSubjects' });

Teacher.belongsToMany(Subject, { through: TeacherSubject, foreignKey: 'teacherId', as: 'subjects' });
Subject.belongsToMany(Teacher, { through: TeacherSubject, foreignKey: 'subjectId', as: 'teachers' });

ReportComment.belongsTo(Student, { foreignKey: 'studentId', as: 'student' });
ReportComment.belongsTo(Class, { foreignKey: 'classId', as: 'class' });
ReportComment.belongsTo(Teacher, { foreignKey: 'teacherId', as: 'teacher' });
Student.hasMany(ReportComment, { foreignKey: 'studentId', as: 'comments' });

// Join table belongsTo (needed for include in list views)
TeacherClass.belongsTo(Teacher, { foreignKey: 'teacherId', as: 'teacher' });
TeacherClass.belongsTo(Class, { foreignKey: 'classId', as: 'class' });

TeacherSubject.belongsTo(Teacher, { foreignKey: 'teacherId', as: 'teacher' });
TeacherSubject.belongsTo(Subject, { foreignKey: 'subjectId', as: 'subject' });
TeacherSubject.belongsTo(Class, { foreignKey: 'classId', as: 'class' });

ClassSubject.belongsTo(Class, { foreignKey: 'classId', as: 'class' });
ClassSubject.belongsTo(Subject, { foreignKey: 'subjectId', as: 'subject' });

Student.hasMany(Attendance, { foreignKey: 'studentId', as: 'attendances' });
Attendance.belongsTo(Student, { foreignKey: 'studentId', as: 'student' });
Attendance.belongsTo(Class, { foreignKey: 'classId', as: 'class' });
Attendance.belongsTo(Teacher, { foreignKey: 'takenBy', as: 'teacher' });

Student.hasMany(Mark, { foreignKey: 'studentId', as: 'marks' });
Mark.belongsTo(Student, { foreignKey: 'studentId', as: 'student' });
Mark.belongsTo(Subject, { foreignKey: 'subjectId', as: 'subject' });
Mark.belongsTo(Class, { foreignKey: 'classId', as: 'class' });
Mark.belongsTo(Teacher, { foreignKey: 'enteredBy', as: 'teacher' });

module.exports = {
  sequelize,
  AcademicYear,
  Term,
  Department,
  Teacher,
  Admin,
  Class,
  Stream,
  Subject,
  Student,
  ReportComment,
  TeacherClass,
  TeacherSubject,
  ClassSubject,
  PublicHoliday,
  Attendance,
  Mark
};

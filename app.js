require('dotenv').config();
const express = require('express');
const { startScheduler } = require('./utils/scheduler');
const session = require('express-session');
const flash = require('express-flash');
const methodOverride = require('method-override');
const path = require('path');
const { Sequelize } = require('sequelize');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const sequelize = require('./config/database');
const { Student, Teacher, ReportAccessRequest } = require('./models');
const academicianRoutes = require('./routes/academician');
const {
  customPermissionForRequest,
  hasCustomPermission,
} = require('./middleware/auth');

const app = express();

// ── View Engine ────────────────────────────────────────────────────────────────
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// ── Static Files ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Body Parser ────────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json());
app.use(methodOverride('_method'));

// ── Session ────────────────────────────────────────────────────────────────────
const sessionStore = new SequelizeStore({ db: sequelize, checkExpirationInterval: 15 * 60 * 1000, expiration: 24 * 60 * 60 * 1000 });

app.use(session({
  secret: process.env.SESSION_SECRET || 'school_secret_key',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true }
}));

sessionStore.sync();

// ── Flash ──────────────────────────────────────────────────────────────────────
app.use(flash());

const { teacherTeachesYear11 } = require('./utils/electives');
const { recordActivity } = require('./utils/activityLog');

function renderAccessDenied(req, res, message) {
  const teacher = req.session && req.session.teacher;
  const returnUrl = req.session && req.session.admin ?
    '/admin/dashboard' :
    teacher && teacher.role === 'head_of_department' ?
      '/teacher/reports/exam-analysis' :
      teacher && teacher.role === 'exam_officer' ?
        '/teacher/reports/examination' :
        teacher && teacher.role === 'principal' ?
          '/teacher/dashboard' :
          '/teacher/dashboard';
  return res.status(403).render('permission-denied', {
    title: 'Access Restricted',
    message,
    returnUrl,
    user: teacher || (req.session && req.session.admin) || null,
  });
}

app.use(async (req, res, next) => {
  if (!req.session || !req.session.teacher) return next();
  try {
    const account = await Teacher.findById(req.session.teacher.id, {
      attributes: ['id', 'fullName', 'role', 'departmentId', 'customPermissions', 'isActive'],
    });
    if (!account || !account.isActive) {
      return req.session.destroy((err) => {
        if (err) return next(err);
        res.redirect('/auth/teacher/login');
      });
    }
    let customPermissions = null;
    if (account.customPermissions) {
      try {
        customPermissions = JSON.parse(account.customPermissions);
      } catch (err) {
        return res.status(500).send('Unable to load account permissions');
      }
      if (!customPermissions || typeof customPermissions !== 'object' || Array.isArray(customPermissions)) {
        return res.status(500).send('Unable to load account permissions');
      }
    }
    req.session.teacher = {
      id: account.id,
      fullName: account.fullName,
      role: account.role,
      departmentId: account.departmentId,
      customPermissions,
    };
    next();
  } catch (err) {
    next(err);
  }
});

app.use((req, res, next) => {
  const teacher = req.session && req.session.teacher;
  if ((req.session && req.session.admin) || !teacher ||
      teacher.role === 'admin' || !/^\/admin(?:\/|$)/.test(req.path)) return next();
  const teacherPath = req.path.replace(/^\/admin(?=\/|$)/, '/teacher');
  const destination = teacherPath === '/teacher' ? '/teacher/dashboard' : teacherPath;
  return res.redirect(307, `${destination}${req.originalUrl.slice(req.path.length)}`);
});

app.use((req, res, next) => {
  const teacher = req.session && req.session.teacher;
  if ((req.session && req.session.admin) || !teacher ||
      teacher.role === 'admin' || !/^\/academician(?:\/|$)/.test(req.path)) return next();
  const teacherPath = req.path.replace(
    /^\/academician\/(discipline|electives|lesson-plans)(?=\/|$)/,
    '/teacher/$1',
  ).replace(/^\/academician(?=\/|$)/, '/teacher/academician');
  return res.redirect(307, `${teacherPath}${req.originalUrl.slice(req.path.length)}`);
});

app.use((req, res, next) => {
  const admin = req.session && req.session.admin;
  const teacher = req.session && req.session.teacher;
  if (!admin && !teacher) return next();
  if (req.path === '/admin/activity-logs') return next();
  const actor = admin ? {
    actorType: 'admin',
    actorId: admin.id,
    actorName: admin.username || 'Admin',
    actorRole: 'admin',
  } : {
    actorType: 'teacher',
    actorId: teacher.id,
    actorName: teacher.fullName || 'Teacher',
    actorRole: teacher.role || 'teacher',
  };
  res.on('finish', () => {
    recordActivity({
      ...actor,
      action: `${req.method} ${req.path}`.slice(0, 300),
      method: req.method.slice(0, 10),
      path: req.path.slice(0, 255),
      statusCode: res.statusCode,
      ipAddress: (req.socket && req.socket.remoteAddress || '').slice(0, 45) || null,
    });
  });
  next();
});

// ── Locals ────────────────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  res.locals.session = req.session;
  res.locals.routeBase = req.session && req.session.admin ? '/admin' : '/teacher';
  res.locals.pendingReportAccessRequestCount = 0;
  const isAdmin = Boolean(req.session && req.session.admin);
  const isHeadOfDepartment =
    req.session && req.session.teacher &&
    req.session.teacher.role === 'head_of_department';
  if (isAdmin || isHeadOfDepartment) {
    try {
      const where = { status: 'pending' };
      if (!isAdmin) where.departmentId = req.session.teacher.departmentId;
      res.locals.pendingReportAccessRequestCount = await ReportAccessRequest.count({ where });
    } catch (err) {
      return next(err);
    }
  }
  res.locals.customPermissions = req.session.teacher && req.session.teacher.customPermissions ?
    req.session.teacher.customPermissions :
    {};
  res.locals.canManageYear11Electives = false;
  if (req.session && req.session.admin) {
    res.locals.canManageYear11Electives = true;
  } else if (req.session && req.session.teacher) {
    try {
      res.locals.canManageYear11Electives =
        req.session.teacher.role === 'head_of_department' ||
        await teacherTeachesYear11(req.session.teacher.id) ||
        hasCustomPermission(req.session.teacher, 'year11', 'view');
    } catch (e) {
      res.locals.canManageYear11Electives = false;
    }
  }
  next();
});

app.use((req, res, next) => {
  const teacher = req.session && req.session.teacher;
  if (!teacher || !teacher.customPermissions) return next();

  const requested = customPermissionForRequest(req);
  if (!requested) return next();
  if (hasCustomPermission(teacher, requested.module, requested.action)) return next();
  let permissions = {};
  try {
    permissions = teacher.customPermissions;
  } catch (err) {
    console.error('Unable to read custom user permissions:', err.message);
    return res.status(500).send('Unable to load account permissions');
  }
  if (!Object.prototype.hasOwnProperty.call(permissions, requested.module)) return next();
  renderAccessDenied(
    req,
    res,
    `Your custom permissions do not allow ${requested.action} access to ${requested.module.replace('_', ' ')}.`,
  );
});

app.use((req, res, next) => {
  const teacher = req.session && req.session.teacher;
  if (!teacher) return next();
  const role = teacher.role;
  if (["principal", "head_of_department", "exam_officer"].includes(role) &&
      /^\/auth\/teacher\/(?:change-password|first-change-password)(?:\/|$)/.test(req.path)) {
    return next();
  }
  const requestedPermission = customPermissionForRequest(req);
  if (requestedPermission && hasCustomPermission(teacher, requestedPermission.module, requestedPermission.action)) {
    return next();
  }
  if (role === "principal") {
    if (req.path.startsWith('/admin/teachers/') && req.path.endsWith('/permissions')) {
      return renderAccessDenied(req, res, 'Only an administrator can manage user permissions.');
    }
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    return renderAccessDenied(req, res, 'The principal account has read-only access.');
  }
  if (role === "head_of_department") {
    const reportReviewPath = /^\/teacher\/report-access-requests(?:\/review\/\d+)?$/.test(req.path);
    const academicianOperationPath =
      /^\/teacher\/(?:discipline|lesson-plans|electives|academician\/teachers)(?:\/|$)/.test(req.path);
    const allowedPath = /^\/teacher\/reports\/(examination|exam-analysis|print-all-report-cards|print-all-final-reports|academic-report)(\/|$)/.test(req.path) ||
      /^\/teacher\/(?:discipline|electives|lesson-plans|teachers)(?:\/|$)/.test(req.path) ||
      /^\/teacher\/academician\/teachers(?:\/|$)/.test(req.path) ||
      req.path === '/teacher/dashboard' ||
      reportReviewPath ||
      req.path === '/' ||
      /^\/(?:auth\/logout|auth\/teacher\/(?:change-password|first-change-password))(?:\/|$)/.test(req.path);
    if (!allowedPath) return renderAccessDenied(req, res, 'This account has access to academic activities in its assigned department, including exam analysis, examination reports, discipline, Year 11 options, and lesson plans.');
    if (req.method !== 'GET' && req.method !== 'HEAD' &&
        !academicianOperationPath &&
        !(reportReviewPath && req.method === 'POST' && /^\/teacher\/report-access-requests\/review\/\d+$/.test(req.path))) {
      return renderAccessDenied(req, res, 'This role has read-only access.');
    }
  }
  if (role === "exam_officer") {
    const allowedPath = /^\/teacher\/reports\/(examination|exam-analysis|print-all-report-cards|print-all-final-reports|academic-report)(\/|$)/.test(req.path) ||
      req.path === '/' ||
      /^\/(?:auth\/logout|auth\/teacher\/(?:change-password|first-change-password))(?:\/|$)/.test(req.path);
    if (!allowedPath) return renderAccessDenied(req, res, 'This account only has access to examination and academic reports.');
    if (req.method !== 'GET' && req.method !== 'HEAD') return renderAccessDenied(req, res, 'This role has read-only access.');
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  if (req.session.teacher && req.session.teacher.role === 'principal') return res.redirect('/teacher/dashboard');
  if (req.session.teacher && req.session.teacher.role === 'head_of_department') return res.redirect('/teacher/dashboard');
  if (req.session.teacher && req.session.teacher.role === 'exam_officer') return res.redirect('/teacher/reports/examination');
  if (req.session.teacher) return res.redirect('/teacher/dashboard');
  res.render('index', { title: 'Welcome' });
});

app.get('/teacher', (req, res) => res.redirect('/teacher/dashboard'));
app.use('/auth', require('./routes/auth'));
app.use('/teacher', require('./routes/teacher'));
app.use('/teacher', require('./routes/admin'));
app.use('/admin', require('./routes/admin'));
app.use('/teacher/academician', academicianRoutes);
app.use('/academician/electives', require('./routes/electives'));
app.use('/academician', academicianRoutes);
app.use('/teacher/lesson-plans', require('./routes/lessonPlans'));
app.use('/academician/lesson-plans', require('./routes/lessonPlans'));
app.use('/admin/lesson-plans', require('./routes/lessonPlans'));
app.use('/discipline', require('./routes/discipline'));
app.use('/admin/discipline', require('./routes/discipline'));
app.use('/teacher/discipline', require('./routes/discipline'));
app.use('/academician/discipline', require('./routes/discipline'));
app.use('/admin/electives', require('./routes/electives'));
app.use('/teacher/electives', require('./routes/electives'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', {
    title: 'Page Not Found',
    user: req.session.teacher || req.session.admin,
  });
});

// ── Error Handler ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Server Error',
    message: err.message,
    user: req.session.teacher || req.session.admin,
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');
    await sequelize.sync({ alter: true });
    const [permissionColumns] = await sequelize.query(
      "SHOW COLUMNS FROM `teachers` LIKE 'customPermissions'",
    );
    if (!permissionColumns.length) {
      await sequelize.query(
        'ALTER TABLE `teachers` ADD COLUMN `customPermissions` TEXT NULL',
      );
      console.log('✅ Added teacher custom permissions column');
    }
    const [roleColumns] = await sequelize.query(
      "SHOW COLUMNS FROM `teachers` LIKE 'role'",
    );
    const supportedRoles = [
      'teacher',
      'class_teacher',
      'academician',
      'head_of_department',
      'principal',
      'exam_officer',
      'admin',
    ];
    const roleType = roleColumns[0] && roleColumns[0].Type ?
      roleColumns[0].Type :
      '';
    if (!supportedRoles.every((role) => roleType.includes(`'${role}'`))) {
      await sequelize.query(
        "ALTER TABLE `teachers` MODIFY COLUMN `role` ENUM('teacher','class_teacher','academician','head_of_department','principal','exam_officer','admin') NOT NULL DEFAULT 'teacher'",
      );
      console.log('✅ Updated teacher role values');
    }
    const [colorColumn] = await sequelize.query(
      "SHOW COLUMNS FROM `timetables` LIKE 'color'",
    );
    if (!colorColumn.length) {
      await sequelize.query(
        "ALTER TABLE `timetables` ADD COLUMN `color` VARCHAR(7) NOT NULL DEFAULT '#dbeafe' AFTER `location`",
      );
      console.log('✅ Added timetable color column');
    }
    console.log('✅ Models synced');
    await Student.update({ status: 'Active' }, { where: { status: null } });
    app.listen(PORT, () => {
      console.log(`   Admin login: http://localhost:${PORT}/auth/admin/login`);
      console.log(`   Teacher login: http://localhost:${PORT}/auth/teacher/login`);
      // Start weekly backup scheduler
      startScheduler();
    });
  } catch (err) {
    console.error('❌ Startup error:', err.message);
    process.exit(1);
  }
}

start();

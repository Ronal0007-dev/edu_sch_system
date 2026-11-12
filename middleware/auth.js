exports.requireAdmin = (req, res, next) => {
  if (req.session && req.session.admin) return next();
  req.flash('error', 'Please login as admin to continue');
  res.redirect('/auth/admin/login');
};

const customPermissionRoutes = [
  ['reports', /^\/(?:admin|teacher)\/reports(?:\/|$)|^\/(?:teacher|academician)\/(?:exam-analysis|academic-report|progressive-report|final-report|report-card|report-cards)(?:\/|$)/],
  ['discipline', /^\/(?:admin\/|academician\/|teacher\/)?discipline(?:\/|$)/],
  ['lesson_plans', /^\/(?:admin\/|academician\/|teacher\/)?lesson-plans(?:\/|$)/],
  ['year11', /^\/(?:admin\/|academician\/|teacher\/)?electives(?:\/|$)/],
  ['students', /^\/admin\/students(?:\/|$)/],
  ['assignments', /^\/admin\/assignments(?:\/|$)/],
  ['attendance', /^\/(?:admin|teacher)\/attendance(?:\/|$)/],
  ['marks', /^\/(?:admin|teacher)\/marks(?:\/|$)/],
  ['classes', /^\/admin\/classes(?:\/|$)/],
  ['streams', /^\/admin\/streams(?:\/|$)/],
  ['subjects', /^\/admin\/subjects(?:\/|$)/],
  ['departments', /^\/admin\/departments(?:\/|$)/],
  ['academic_years', /^\/admin\/(?:academic-years|terms)(?:\/|$)/],
  ['timetable', /^\/(?:admin|teacher)\/timetable(?:\/|$)/],
  ['holidays', /^\/admin\/holidays(?:\/|$)/],
  ['backup', /^\/admin\/backup(?:\/|$)/],
];

exports.customPermissionForRequest = (req) => {
  const path = req.originalUrl.split('?')[0];
  const moduleEntry = customPermissionRoutes.find((entry) => entry[1].test(path));
  if (!moduleEntry) return null;

  let action;
  if (/print|export|academic-report|progressive-report|final-report|report-card/i.test(path)) action = 'print';
  else if (/delete|remove|reset/i.test(path)) action = 'delete';
  else if (/edit|update|role|toggle|status|promote|approve|feedback/i.test(path)) action = 'edit';
  else if (/\/new(?:\/|$)|\/create(?:\/|$)|\/import(?:\/|$)/i.test(path)) action = 'add';
  else if (req.method === 'GET' || req.method === 'HEAD') action = 'view';
  else action = 'add';
  return { module: moduleEntry[0], action };
};

exports.hasCustomPermission = (teacher, moduleName, action) => {
  if (!teacher || !teacher.customPermissions) return false;
  try {
    const permissions = typeof teacher.customPermissions === 'string' ?
      JSON.parse(teacher.customPermissions) :
      teacher.customPermissions;
    return !!permissions &&
      Array.isArray(permissions[moduleName]) &&
      permissions[moduleName].includes(action);
  } catch (err) {
    return false;
  }
};

exports.requireAdminArea = (req, res, next) => {
  if (req.session && req.session.admin) return next();
  const teacher = req.session && req.session.teacher;
  if (!teacher) {
    req.flash('error', 'Please login as admin to continue');
    return res.redirect('/auth/admin/login');
  }
  if (req.baseUrl === '/teacher' &&
      /^\/(?:discipline|electives|lesson-plans|academician)(?:\/|$)/.test(req.path)) {
    return next();
  }
  if (req.path === '/report-access-requests' ||
      /^\/report-access-requests\/review\/\d+$/.test(req.path)) {
    if (teacher.role !== 'head_of_department') {
      return res.status(403).render('permission-denied', {
        title: 'Access Restricted',
        message: 'Only administrators and the assigned Head of Department can review report access requests.',
        returnUrl: teacher.role === 'exam_officer' ?
          '/teacher/reports/examination' :
          teacher.role === 'principal' ?
            '/teacher/dashboard' :
            '/teacher/dashboard',
        user: teacher,
      });
    }
    const isReviewPath = /^\/report-access-requests\/review\/\d+$/.test(req.path);
    if ((req.method === 'GET' && req.path === '/report-access-requests') ||
        (req.method === 'POST' && isReviewPath)) return next();
    return res.status(403).render('permission-denied', {
      title: 'Access Restricted',
      message: 'This action is not available for report access requests.',
      returnUrl: '/teacher/report-access-requests',
      user: teacher,
    });
  }
  if (/^\/teachers\/[^/]+\/(?:permissions|role(?:-academician)?|revoke-role|toggle|delete|reset-password)$/.test(req.path) ||
      /^\/teachers\/(?:edit\/[^/]+)?$/.test(req.path) ||
      (req.path === '/teachers' && req.method !== 'GET')) {
    return res.status(403).render('permission-denied', {
      title: 'Access Restricted',
      message: 'Only an administrator can manage user accounts or permissions.',
      returnUrl: teacher.role === 'head_of_department' ?
        '/teacher/reports/exam-analysis' :
        teacher.role === 'exam_officer' ?
          '/teacher/reports/examination' :
          teacher.role === 'principal' ?
            '/teacher/dashboard' :
            '/teacher/dashboard',
      user: teacher,
    });
  }
  const requestedPermission = exports.customPermissionForRequest(req);
  if (requestedPermission && exports.hasCustomPermission(teacher, requestedPermission.module, requestedPermission.action)) {
    return next();
  }
  if (/^\/backup\/download\/[^/]+$/.test(req.path)) {
    return res.status(403).render('permission-denied', {
      title: 'Access Restricted',
      message: 'A custom backup view permission is required to download database backups.',
      returnUrl: teacher.role === 'principal' ?
        '/teacher/dashboard' :
        teacher.role === 'head_of_department' ?
          '/teacher/reports/exam-analysis' :
          teacher.role === 'exam_officer' ?
            '/teacher/reports/examination' :
            '/teacher/dashboard',
      user: teacher,
    });
  }

  const isReadRequest = req.method === 'GET' || req.method === 'HEAD';
  const path = req.path;
  let allowed = false;
  if (isReadRequest && teacher.role === 'principal') {
    allowed = !path.startsWith('/user-permissions');
  } else if (isReadRequest && teacher.role === 'head_of_department') {
    allowed = /^\/reports\/(examination|exam-analysis|print-all-report-cards|print-all-final-reports|academic-report)(\/|$)/.test(path) ||
      path === '/discipline' ||
      path.startsWith('/discipline/') ||
      path === '/electives' ||
      path.startsWith('/electives/') ||
      path === '/lesson-plans' ||
      path.startsWith('/lesson-plans/');
  } else if (isReadRequest && teacher.role === 'exam_officer') {
    allowed = /^\/reports\/(examination|exam-analysis|print-all-report-cards|print-all-final-reports|academic-report)(\/|$)/.test(path);
  }

  if (allowed) return next();
  return res.status(403).render('permission-denied', {
    title: 'Access Restricted',
    message: 'You do not have permission to access this page.',
    returnUrl: teacher.role === 'head_of_department' ?
      '/teacher/reports/exam-analysis' :
      teacher.role === 'exam_officer' ?
        '/teacher/reports/examination' :
        teacher.role === 'principal' ?
          '/teacher/dashboard' :
          '/teacher/dashboard',
    user: teacher,
  });
};

exports.requireTeacher = (req, res, next) => {
  if (req.session && req.session.teacher) return next();
  req.flash('error', 'Please login to continue');
  res.redirect('/auth/teacher/login');
};

exports.requireAny = (req, res, next) => {
  if ((req.session && req.session.admin) || (req.session && req.session.teacher)) return next();
  res.redirect('/');
};

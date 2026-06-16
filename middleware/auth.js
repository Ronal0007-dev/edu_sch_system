exports.requireAdmin = (req, res, next) => {
  if (req.session && req.session.admin) return next();
  req.flash('error', 'Please login as admin to continue');
  res.redirect('/auth/admin/login');
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

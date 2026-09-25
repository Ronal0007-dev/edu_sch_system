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
const { Student } = require('./models');
const academicianRoutes = require('./routes/academician');

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

// ── Locals ────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session.admin) return res.redirect('/admin/dashboard');
  if (req.session.teacher) return res.redirect('/teacher/dashboard');
  res.render('index', { title: 'Welcome' });
});

app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/teacher', require('./routes/teacher'));
app.use('/academician', academicianRoutes);
app.use('/teacher/lesson-plans', require('./routes/lessonPlans'));
app.use('/academician/lesson-plans', require('./routes/lessonPlans'));
app.use('/admin/lesson-plans', require('./routes/lessonPlans'));
app.use('/discipline', require('./routes/discipline'));
app.use('/admin/discipline', require('./routes/discipline'));
app.use('/teacher/discipline', require('./routes/discipline'));
app.use('/academician/discipline', require('./routes/discipline'));
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

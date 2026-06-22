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

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send(`
    <div style="text-align:center;padding:4rem;font-family:sans-serif">
      <h1 style="font-size:3rem;color:#1a56db">404</h1>
      <p>Page not found</p>
      <a href="/" style="color:#1a56db">← Go Home</a>
    </div>
  `);
});

// ── Error Handler ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send(`
    <div style="text-align:center;padding:4rem;font-family:sans-serif">
      <h1 style="color:#ef4444">Server Error</h1>
      <p>${err.message}</p>
      <a href="/">← Go Home</a>
    </div>
  `);
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');
    await sequelize.sync({ alter: true });
    console.log('✅ Models synced');
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

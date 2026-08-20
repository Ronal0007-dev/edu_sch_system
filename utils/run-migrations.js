const fs = require('fs');
const path = require('path');
const sequelize = require('../config/database');

async function run() {
  const dir = path.join(__dirname);
  const files = fs.readdirSync(dir).filter(f => /^\d{3}.*\.sql$/.test(f)).sort();
  if (!files.length) {
    console.log('No SQL migration files found in utils/');
    process.exit(0);
  }
  for (const file of files) {
    const filePath = path.join(dir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    try {
      console.log('Running migration', file);
      await sequelize.query(sql);
      console.log('OK', file);
    } catch (err) {
      console.error('Migration failed:', file, err.message);
      process.exit(1);
    }
  }
  console.log('Migrations complete');
  process.exit(0);
}

run();

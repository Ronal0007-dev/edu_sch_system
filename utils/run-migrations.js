const fs = require('fs');
const path = require('path');
const sequelize = require('../config/database');

async function run() {
  const dir = path.join(__dirname);
  const files = fs.readdirSync(dir)
    .filter(f => /^\d{3}.*\.(sql|js)$/.test(f))
    .sort();
  if (!files.length) {
    console.log('No SQL migration files found in utils/');
    process.exit(0);
  }
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      console.log('Running migration', file);
      if (file.endsWith('.sql')) {
        await sequelize.query(fs.readFileSync(filePath, 'utf8'));
      } else {
        const migration = require(filePath);
        await migration(sequelize);
      }
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

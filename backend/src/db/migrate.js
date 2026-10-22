// src/db/migrate.js
// Runs db/schema.sql against the database configured in DATABASE_URL

const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function migrate() {
  const schemaPath = path.resolve(__dirname, '../../../db/schema.sql');
  console.log(`Running migration from ${schemaPath}...`);

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('Database migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

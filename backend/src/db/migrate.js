// src/db/migrate.js
// Runs db/schema.sql against the database configured in DATABASE_URL

const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function migrate(existingClient = null) {
  const schemaPath = path.resolve(__dirname, '../../../db/schema.sql');
  console.log(`Running migration from ${schemaPath}...`);

  const client = existingClient || pool;
  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(sql);
    console.log('Database migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    if (!existingClient) {
      process.exit(1);
    }
    throw err;
  } finally {
    if (!existingClient) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };

// src/db/reset.js
// Drops and recreates the public schema, then executes migrate and seed.
// Security check: Refuses execution when NODE_ENV=production.

const path = require('path');
const dotenv = require('dotenv');

// Load environment configuration
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Immediate safety check: refuse execution in production
if (process.env.NODE_ENV === 'production') {
  console.error('CRITICAL: Refusing to reset database in production mode (NODE_ENV=production).');
  process.exit(1);
}

const { pool } = require('./index');
const { migrate } = require('./migrate');
const { seed } = require('../../../db/seed');

async function reset() {
  console.log('Connecting to database for schema reset...');
  const client = await pool.connect();

  try {
    console.log('Dropping and recreating public schema...');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE;');
    await client.query('CREATE SCHEMA public;');
    await client.query('GRANT ALL ON SCHEMA public TO public;');

    console.log('Public schema reset. Running migrations...');
    await migrate(client);

    console.log('Running database seed...');
    await seed(client);

    console.log('Database reset and seeded successfully.');
  } catch (err) {
    console.error('Database reset failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  reset();
}

module.exports = { reset };

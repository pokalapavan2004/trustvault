// src/db/index.js
// PostgreSQL connection pool using pg driver with parameterised queries

const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = {
  // Execute a parameterised query
  query: (text, params) => pool.query(text, params),
  pool
};

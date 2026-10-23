// db/seed.js
// Seeds the initial administrator account from environment variables.
// Regular users register through the web interface and are stored in the users table.

const path = require('path');

// Ensure modules can be resolved from backend/node_modules if running from repo root or db/
const backendNodeModules = path.resolve(__dirname, '../backend/node_modules');
if (!module.paths.includes(backendNodeModules)) {
  module.paths.push(backendNodeModules);
}

const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// Attempt to load .env from root or backend/
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const SALT_ROUNDS = 12;

async function seed(existingClient = null) {
  console.log('Connecting to database for seeding...');

  const adminUsername = process.env.SEED_ADMIN_USERNAME;
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  // Validate that all three required admin credentials are provided
  const missing = [];
  if (!adminUsername || !adminUsername.trim()) missing.push('SEED_ADMIN_USERNAME');
  if (!adminEmail || !adminEmail.trim()) missing.push('SEED_ADMIN_EMAIL');
  if (!adminPassword) missing.push('SEED_ADMIN_PASSWORD');

  if (missing.length > 0) {
    console.error('Error: Missing required seed environment variables:');
    missing.forEach((v) => console.error(`  - ${v}`));
    if (!existingClient) {
      process.exit(1);
    }
    throw new Error(`Missing required seed environment variables: ${missing.join(', ')}`);
  }

  const client = existingClient || (await pool.connect());
  const shouldManageTx = !existingClient;

  try {
    if (shouldManageTx) {
      await client.query('BEGIN');
    }

    const cleanUsername = adminUsername.trim();
    const normalisedEmail = adminEmail.trim().toLowerCase();

    // Check if an account with this email already exists (idempotent: never overwrite password)
    const existingCheck = await client.query(
      'SELECT id, username, email, role FROM users WHERE LOWER(email) = LOWER($1)',
      [normalisedEmail]
    );

    if (existingCheck.rows.length > 0) {
      const existing = existingCheck.rows[0];
      console.log(`Admin account already exists for ${existing.email} (id: ${existing.id}). Skipping seed (passwords are never overwritten).`);
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

      const query = `
        INSERT INTO users (username, email, password_hash, role, full_name, is_active)
        VALUES ($1, $2, $3, 'admin', 'System Administrator', true)
        ON CONFLICT (email) DO NOTHING
        RETURNING id, username, email, role, is_active;
      `;

      const res = await client.query(query, [cleanUsername, normalisedEmail, passwordHash]);
      if (res.rows.length > 0) {
        const created = res.rows[0];
        console.log(`Seeded admin user: [${created.role}] ${created.username} <${created.email}> (id: ${created.id})`);
      }
    }

    if (shouldManageTx) {
      await client.query('COMMIT');
    }
    console.log('Database seeding completed successfully.');
  } catch (err) {
    if (shouldManageTx) {
      await client.query('ROLLBACK');
    }
    console.error('Seeding failed:', err.message);
    if (!existingClient) {
      process.exit(1);
    }
    throw err;
  } finally {
    if (!existingClient) {
      client.release();
      await pool.end();
    }
  }
}

if (require.main === module) {
  seed();
}

module.exports = { seed };

// db/seed.js
// Seeds initial users (1 admin, 2 owners, 2 viewers) with passwords from environment variables

const path = require('path');
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

const seedUsers = [
  {
    role: 'admin',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@trustvault.local',
    password: process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD
  },
  {
    role: 'owner',
    email: process.env.SEED_OWNER1_EMAIL || 'owner1@trustvault.local',
    password: process.env.SEED_OWNER1_PASSWORD || process.env.OWNER1_PASSWORD
  },
  {
    role: 'owner',
    email: process.env.SEED_OWNER2_EMAIL || 'owner2@trustvault.local',
    password: process.env.SEED_OWNER2_PASSWORD || process.env.OWNER2_PASSWORD
  },
  {
    role: 'viewer',
    email: process.env.SEED_VIEWER1_EMAIL || 'viewer1@trustvault.local',
    password: process.env.SEED_VIEWER1_PASSWORD || process.env.VIEWER1_PASSWORD
  },
  {
    role: 'viewer',
    email: process.env.SEED_VIEWER2_EMAIL || 'viewer2@trustvault.local',
    password: process.env.SEED_VIEWER2_PASSWORD || process.env.VIEWER2_PASSWORD
  }
];

async function seed() {
  console.log('Connecting to database...');

  // Validate that all required passwords are provided in environment variables
  const missingPasswords = [];
  if (!seedUsers[0].password) missingPasswords.push('SEED_ADMIN_PASSWORD (or ADMIN_PASSWORD)');
  if (!seedUsers[1].password) missingPasswords.push('SEED_OWNER1_PASSWORD (or OWNER1_PASSWORD)');
  if (!seedUsers[2].password) missingPasswords.push('SEED_OWNER2_PASSWORD (or OWNER2_PASSWORD)');
  if (!seedUsers[3].password) missingPasswords.push('SEED_VIEWER1_PASSWORD (or VIEWER1_PASSWORD)');
  if (!seedUsers[4].password) missingPasswords.push('SEED_VIEWER2_PASSWORD (or VIEWER2_PASSWORD)');

  if (missingPasswords.length > 0) {
    console.error('Error: Missing required seed passwords in environment variables:');
    missingPasswords.forEach((key) => console.error(`  - ${key}`));
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const u of seedUsers) {
      const passwordHash = await bcrypt.hash(u.password, SALT_ROUNDS);

      // Parameterised upsert: create user or update password and role if already exists
      const query = `
        INSERT INTO users (email, password_hash, role, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (email)
        DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          is_active = true
        RETURNING id, email, role, is_active;
      `;

      const res = await client.query(query, [u.email, passwordHash, u.role]);
      const created = res.rows[0];
      console.log(`Seeded user: [${created.role}] ${created.email} (id: ${created.id})`);
    }

    await client.query('COMMIT');
    console.log('Database seeding completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();

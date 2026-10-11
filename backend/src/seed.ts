import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import pool from './db/pool.js';

const firstNames = ['Aarav', 'Aditi', 'Arjun', 'Diya', 'Ishaan', 'Kavya', 'Meera', 'Rohan', 'Saanvi', 'Vivaan'];
const lastNames = ['Sharma', 'Patel', 'Kulkarni', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Joshi', 'Mehta', 'Rao'];
const eventNames = ['Campus Welcome Night', 'CodeSprint Hackathon', 'Annual Cultural Fest', 'Photography Walk', 'Open Mic Evening', 'Tech Talks', 'Inter-College Debate', 'Sustainability Week', 'Design Jam', 'Community Clean-Up'];
const expenseNames = ['Printing posters', 'Volunteer refreshments', 'Event decorations', 'Audio equipment rental', 'Workshop stationery', 'Cleaning supplies', 'Transport materials', 'Photography equipment'];
const password = 'SkylineDemo@123';

const dateFromNow = (days: number, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

async function seed() {
  if (!pool) throw new Error('DB_URL is not configured.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO roles (name)
      VALUES ('ADMIN'), ('STUDENT'), ('MEMBER'), ('TREASURER'), ('VOLUNTEER')
      ON CONFLICT (name) DO NOTHING
    `);
    const roles = await client.query('SELECT id, name FROM roles');
    const roleIds = new Map(roles.rows.map((row) => [row.name, Number(row.id)]));
    const passwordHash = await bcrypt.hash(password, 10);
    const userIds: number[] = [];

    for (let i = 1; i <= 200; i += 1) {
      const email = `seed.user${String(i).padStart(4, '0')}@skyline.demo`;
      const user = await client.query(
        `INSERT INTO users (name, email, password_hash, is_active)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [`${firstNames[(i - 1) % firstNames.length]} ${lastNames[(i * 7) % lastNames.length]} ${String(i).padStart(3, '0')}`, email, passwordHash],
      );
      const userId = Number(user.rows[0].id);
      userIds.push(userId);
      const roleName = i === 1 ? 'ADMIN' : i === 2 ? 'TREASURER' : i % 5 === 0 ? 'VOLUNTEER' : i % 3 === 0 ? 'MEMBER' : 'STUDENT';
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, roleIds.get(roleName)],
      );
    }

    const plans = [
      ['Basic', 300, { eventDiscount: 5 }],
      ['Standard', 600, { eventDiscount: 15, merchandiseDiscount: 10 }],
      ['Premium', 1200, { eventDiscount: 30, merchandiseDiscount: 20 }],
    ];
    const planIds: number[] = [];
    for (const [name, price, benefits] of plans) {
      const result = await client.query(
        `INSERT INTO membership_plans (name, price, duration_days, benefits, is_active)
         VALUES ($1, $2, 365, $3::jsonb, TRUE)
         ON CONFLICT (name) DO UPDATE SET is_active = TRUE
         RETURNING id`,
        [name, price, JSON.stringify(benefits)],
      );
      planIds.push(Number(result.rows[0].id));
    }
    for (let i = 0; i < 150; i += 1) {
      await client.query(
        `INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
         SELECT $1, $2, CURRENT_DATE - $3::integer, CURRENT_DATE - $3::integer + 365, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM memberships WHERE user_id = $1 AND plan_id = $2 AND start_date = CURRENT_DATE - $3::integer
         )`,
        [userIds[i], planIds[i % planIds.length], i % 120, i % 12 === 0 ? 'expired' : i % 17 === 0 ? 'pending' : 'active'],
      );
    }

    const eventIds: number[] = [];
    for (let i = 0; i < eventNames.length; i += 1) {
      const eventTitle = eventNames[i]!;
      const location = ['Main Auditorium', 'Innovation Lab', 'Central Lawn', 'Seminar Hall B'][i % 4]!;
      const startsAt = dateFromNow(i - 2, 10 + (i % 8));
      const event = await client.query(
        `INSERT INTO events (title, description, location, starts_at, ends_at, status, organizer_id)
         SELECT $1, $2, $3, $4, $5, $6, $7
         WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = $1::varchar)
         RETURNING id`,
        [eventTitle, `Join the student community for ${eventTitle.toLowerCase()}.`, location, startsAt, new Date(startsAt.getTime() + 3 * 60 * 60 * 1000), i < 2 ? 'completed' : 'published', userIds[0]!],
      );
      if (event.rows[0]) eventIds.push(Number(event.rows[0].id));
    }
    for (const eventId of eventIds) {
      await client.query(
        `INSERT INTO ticket_types (event_id, name, member_price, non_member_price, quantity_available, sales_start, sales_end)
         VALUES ($1, 'General', 100, 150, 100, NOW() - INTERVAL '14 days', NOW() + INTERVAL '365 days')
         ON CONFLICT (event_id, name) DO NOTHING`,
        [eventId],
      );
    }

    for (let i = 0; i < 8; i += 1) {
      const fundraiser = await client.query(
        `INSERT INTO fundraisers (name, description, starts_at, ends_at, target_amount, status, created_by)
         SELECT $1, $2, $3, $4, $5, $6, $7
         WHERE NOT EXISTS (SELECT 1 FROM fundraisers WHERE name = $1::varchar)
         RETURNING id`,
        [`Student Initiative ${i + 1}`, 'A student-led fundraising campaign for campus activities.', dateFromNow(-20 + i), dateFromNow(30 + i), 5000 + i * 2500, i < 2 ? 'completed' : i < 6 ? 'active' : 'planned', userIds[0]],
      );
      if (fundraiser.rows[0]) {
        for (let j = 0; j < 4; j += 1) {
          await client.query(
            `INSERT INTO tasks (fundraiser_id, title, description, due_at, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [fundraiser.rows[0].id, `Volunteer task ${i * 4 + j + 1}`, 'Coordinate with the student organization team.', dateFromNow(j + 1, 17), j === 0 ? 'in_progress' : 'todo', userIds[0]],
          );
        }
      }
    }

    for (let i = 0; i < 40; i += 1) {
      const amount = 150 + ((i * 137) % 4800);
      await client.query(
        `INSERT INTO expenses (submitted_by, description, amount, expense_date, receipt_url, status, reviewed_by, reviewed_at, reimbursed_at)
         VALUES ($1, $2, $3, CURRENT_DATE - $4::integer, $5, $6, $7, $8, $9)`,
        [userIds[(i * 5 + 8) % userIds.length], `${expenseNames[i % expenseNames.length]} (demo ${i + 1})`, amount, i % 60, `https://example.com/demo-receipts/expense-${i + 1}.pdf`, i % 9 === 0 ? 'rejected' : i % 5 === 0 ? 'submitted' : i % 3 === 0 ? 'reimbursed' : 'approved', i % 5 === 0 ? null : userIds[1], i % 5 === 0 ? null : dateFromNow(-(i % 10)), i % 3 === 0 ? dateFromNow(-(i % 5)) : null],
      );
    }

    await client.query('COMMIT');
    console.log('Seeding completed successfully.');
    console.log(`Demo users: ${userIds.length}`);
    console.log(`Demo password: ${password}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error('Seeding failed. All changes were rolled back.', error);
  process.exitCode = 1;
});

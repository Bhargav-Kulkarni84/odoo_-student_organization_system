
import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';
import {createAnnouncementSchema,updateAnnouncementSchema,publishAnnouncementSchema} from '../validation/anouncement.schema.js'

const router = Router();

// GET /api/v1/announcements
// Public users can view published announcements.
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.title, a.body, a.published_at,
              u.name AS published_by_name
       FROM announcements a
       LEFT JOIN users u ON u.id = a.published_by
       WHERE a.status = 'published'
       ORDER BY a.published_at DESC`,
    );

    return res.json({ announcements: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: 'Failed to fetch announcements',
    });
  }
});

// GET /api/v1/announcements/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.title, a.body, a.published_at,
              u.name AS published_by_name
       FROM announcements a
       LEFT JOIN users u ON u.id = a.published_by
       WHERE a.id = $1 AND a.status = 'published'`,
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    return res.json({ announcement: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: 'Failed to fetch announcement',
    });
  }
});

// POST /api/v1/announcements
router.post('/', authenticate, async (req, res) => {
  const parsed = createAnnouncementSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid announcement',
      errors: parsed.error.flatten(),
    });
  }

  try {
    const { title, body } = parsed.data;

    const result = await pool.query(
      `INSERT INTO announcements (title, body, published_by, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING *`,
      [title, body, req.user!.id],
    );

    return res.status(201).json({ announcement: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: 'Failed to create announcement',
    });
  }
});

// PATCH /api/v1/announcements/:id
// Drafts can be edited; published announcements cannot be edited here.
router.patch('/:id', authenticate, async (req, res) => {
  const parsed = updateAnnouncementSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid update',
      errors: parsed.error.flatten(),
    });
  }

  const fields = parsed.data;
  const allowed = ['title', 'body'] as const;
  const updates = allowed.filter((key) =>
    Object.prototype.hasOwnProperty.call(fields, key),
  );

  try {
    const values = updates.map((key) => fields[key]);
    const assignments = updates.map(
      (key, index) => `${key} = $${index + 1}`,
    );

    const result = await pool.query(
      `UPDATE announcements
       SET ${assignments.join(', ')}
       WHERE id = $${values.length + 1} AND status = 'draft'
       RETURNING *`,
      [...values, req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({
        message: 'Draft announcement not found',
      });
    }

    return res.json({ announcement: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: 'Failed to update announcement',
    });
  }
});

// POST /api/v1/announcements/:id/publish
router.post('/:id/publish', authenticate, async (req, res) => {
  const parsed = publishAnnouncementSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid recipient list',
      errors: parsed.error.flatten(),
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const announcementResult = await client.query(
      `SELECT id, status
       FROM announcements
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id],
    );

    if (!announcementResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Announcement not found' });
    }

    if (announcementResult.rows[0].status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Only draft announcements can be published',
      });
    }

    let recipientsResult;

    if (parsed.data.user_ids) {
      const userIds = [...new Set(parsed.data.user_ids)];

      recipientsResult = await client.query(
        `SELECT id
         FROM users
         WHERE is_active = TRUE AND id = ANY($1::bigint[])`,
        [userIds],
      );

      if (recipientsResult.rowCount !== userIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: 'One or more recipient IDs do not exist or are inactive',
        });
      }
    } else {
      recipientsResult = await client.query(
        `SELECT id FROM users WHERE is_active = TRUE`,
      );
    }

    for (const recipient of recipientsResult.rows) {
      await client.query(
        `INSERT INTO announcement_recipients
           (announcement_id, user_id, email_status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (announcement_id, user_id) DO NOTHING`,
        [req.params.id, recipient.id],
      );
    }

    const updated = await client.query(
      `UPDATE announcements
       SET status = 'published', published_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id],
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Announcement published; email delivery is queued as pending',
      announcement: updated.rows[0],
      recipient_count: recipientsResult.rowCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({
      message: 'Failed to publish announcement',
    });
  } finally {
    client.release();
  }
});

// POST /api/v1/announcements/:id/archive
router.post('/:id/archive', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE announcements
       SET status = 'archived'
       WHERE id = $1 AND status IN ('draft', 'published')
       RETURNING id, status`,
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({
        message: 'Announcement not found or already archived',
      });
    }

    return res.json({
      message: 'Announcement archived',
      announcement: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: 'Failed to archive announcement',
    });
  }
});

// GET /api/v1/announcements/:id/recipients
router.get('/:id/recipients', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ar.user_id, u.name, u.email,
              ar.email_status, ar.sent_at
       FROM announcement_recipients ar
       JOIN users u ON u.id = ar.user_id
       WHERE ar.announcement_id = $1
       ORDER BY u.name`,
      [req.params.id],
    );

    return res.json({ recipients: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: 'Failed to fetch recipient statuses',
    });
  }
});

export default router;

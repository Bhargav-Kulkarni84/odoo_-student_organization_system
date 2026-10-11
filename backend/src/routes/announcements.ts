
import { Router } from 'express';
import pool, { isDatabaseConfigured } from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';
import {createAnnouncementSchema,updateAnnouncementSchema,publishAnnouncementSchema} from '../validation/anouncement.schema.js'
import { sendBrevoAnnouncement } from '../services/brevo.js';

const router = Router();

// GET /api/v1/announcements
// Public users can view published announcements.
router.get('/', async (_req, res) => {
  if (!isDatabaseConfigured || !pool) {
    return res.status(503).json({ message: 'Announcement service is temporarily unavailable' });
  }
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
  if (!isDatabaseConfigured || !pool) {
    return res.status(503).json({ message: 'Announcement service is temporarily unavailable' });
  }
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
  if (!isDatabaseConfigured || !pool) {
    return res.status(503).json({ message: 'Announcement service is temporarily unavailable' });
  }
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
  if (!isDatabaseConfigured || !pool) {
    return res.status(503).json({ message: 'Announcement service is temporarily unavailable' });
  }
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
  if (!isDatabaseConfigured || !pool) {
    return res.status(503).json({ message: 'Announcement service is temporarily unavailable' });
  }
  const parsed = publishAnnouncementSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid recipient list',
      errors: parsed.error.flatten(),
    });
  }

  const { audience, event_id, club_id } = parsed.data;
  const access = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.name IN ('ADMIN', 'TEAM_LEAD')
     ) AS is_global_manager`,
    [req.user!.id],
  );
  let targetClubId = club_id;
  if (audience === 'event_participants') {
    const event = await pool.query('SELECT club_id FROM events WHERE id = $1', [event_id]);
    if (!event.rowCount) return res.status(404).json({ message: 'Event not found' });
    targetClubId = event.rows[0].club_id;
  }
  if (!access.rows[0].is_global_manager) {
    if (audience === 'all_users' || !targetClubId) {
      return res.status(403).json({ message: 'Only global managers can send campus-wide announcements' });
    }
    const membership = await pool.query(
      `SELECT 1 FROM club_members
       WHERE club_id = $1 AND user_id = $2 AND role IN ('lead', 'admin')`,
      [targetClubId, req.user!.id],
    );
    if (!membership.rowCount) {
      return res.status(403).json({ message: 'You can only announce to clubs you manage' });
    }
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

    const { user_ids } = parsed.data;
    let recipientsResult;
    if (audience === 'event_participants') {
      recipientsResult = await client.query(
        `SELECT DISTINCT u.id, u.name, u.email
         FROM users u
         JOIN ticket_orders o ON o.user_id = u.id AND o.status IN ('pending', 'paid')
         JOIN tickets t ON t.ticket_order_id = o.id
         JOIN ticket_types tt ON tt.id = t.ticket_type_id
         WHERE tt.event_id = $1 AND u.is_active = TRUE`,
        [event_id],
      );
    } else if (audience === 'club_members') {
      recipientsResult = await client.query(
        `SELECT u.id, u.name, u.email
         FROM users u
         JOIN club_members cm ON cm.user_id = u.id
         WHERE cm.club_id = $1 AND u.is_active = TRUE`,
        [club_id],
      );
    } else if (audience === 'club_user') {
      recipientsResult = await client.query(
        `SELECT u.id, u.name, u.email
         FROM users u
         JOIN club_members cm ON cm.user_id = u.id
         WHERE cm.club_id = $1 AND u.is_active = TRUE
         ORDER BY u.name`,
        [club_id],
      );
    } else if (audience === 'individual_users') {
      const uniqueUserIds = [...new Set(user_ids ?? [])];
      recipientsResult = await client.query(
        `SELECT u.id, u.name, u.email
         FROM users u
         ${club_id ? 'JOIN club_members cm ON cm.user_id = u.id AND cm.club_id = $2' : ''}
         WHERE u.is_active = TRUE AND u.id = ANY($1::bigint[])`,
        club_id ? [uniqueUserIds, club_id] : [uniqueUserIds],
      );
      if (recipientsResult.rowCount !== uniqueUserIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'One or more recipient IDs do not exist or are inactive' });
      }
    } else {
      recipientsResult = await client.query(`SELECT id, name, email FROM users WHERE is_active = TRUE`);
    }

    if (!recipientsResult.rowCount) {
      await client.query('ROLLBACK');
      const audienceMessages: Record<string, string> = {
        event_participants: 'No students have reserved or paid for tickets to this event yet',
        club_members: 'This club has no active members yet',
        club_user: 'This club has no active members yet',
        individual_users: 'None of the selected students are active members of this audience',
        all_users: 'There are no active users to notify',
      };
      return res.status(400).json({
        message: audienceMessages[audience] || 'No active recipients matched this audience',
      });
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

    const recipients = recipientsResult.rows;
    const deliveredIds: number[] = [];
    const failedIds: number[] = [];
    try {
      for (let index = 0; index < recipients.length; index += 50) {
        const batch = recipients.slice(index, index + 50);
        try {
          await sendBrevoAnnouncement({
            subject: updated.rows[0].title,
            body: updated.rows[0].body,
            recipients: batch.map((recipient) => ({ name: recipient.name, email: recipient.email })),
          });
          deliveredIds.push(...batch.map((recipient) => recipient.id));
        } catch (error) {
          failedIds.push(...batch.map((recipient) => recipient.id));
          throw error;
        }
      }
      await pool.query(
        `UPDATE announcement_recipients SET email_status = 'sent', sent_at = NOW()
         WHERE announcement_id = $1 AND user_id = ANY($2::bigint[])`,
        [req.params.id, deliveredIds],
      );
      return res.json({
        message: 'Announcement published and delivered through Brevo',
        announcement: updated.rows[0],
        recipient_count: recipients.length,
        delivery_status: 'sent',
      });
    } catch (deliveryError) {
      console.error('Brevo announcement delivery failed:', deliveryError);
      await pool.query(
        `UPDATE announcement_recipients SET email_status = 'failed'
         WHERE announcement_id = $1 AND user_id = ANY($2::bigint[])`,
        [req.params.id, failedIds.concat(recipients.filter((recipient) => !deliveredIds.includes(recipient.id) && !failedIds.includes(recipient.id)).map((recipient) => recipient.id))],
      );
      return res.status(502).json({
        message: deliveryError instanceof Error ? deliveryError.message : 'Announcement published, but Brevo delivery failed',
        announcement: updated.rows[0],
        recipient_count: recipients.length,
        delivery_status: 'failed',
      });
    }
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
  if (!isDatabaseConfigured || !pool) {
    return res.status(503).json({ message: 'Announcement service is temporarily unavailable' });
  }
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

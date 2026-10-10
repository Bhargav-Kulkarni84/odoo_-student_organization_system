
import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';
import {createTaskSchema,updateTaskSchema,assignTaskSchema} from '../validation/task.schema.js'

const router = Router();

// GET /api/v1/tasks
// List tasks, optionally filtered by status or fundraiser.
router.get('/', authenticate, async (req, res) => {
  const status = req.query.status;
  const fundraiserId = req.query.fundraiser_id;

  if (
    status !== undefined &&
    !['todo', 'in_progress', 'done', 'cancelled'].includes(String(status))
  ) {
    return res.status(400).json({ message: 'Invalid task status' });
  }

  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.description, t.fundraiser_id,
              t.due_at, t.status, t.created_by, t.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'user_id', u.id,
                    'name', u.name
                  )
                ) FILTER (WHERE u.id IS NOT NULL),
                '[]'::json
              ) AS assignees
       FROM tasks t
       LEFT JOIN task_assignments ta ON ta.task_id = t.id
       LEFT JOIN users u ON u.id = ta.user_id
       WHERE ($1::text IS NULL OR t.status = $1)
         AND ($2::bigint IS NULL OR t.fundraiser_id = $2)
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [
        status === undefined ? null : String(status),
        fundraiserId === undefined ? null : String(fundraiserId),
      ],
    );

    return res.json({ tasks: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch tasks' });
  }
});

// GET /api/v1/tasks/me
// Tasks assigned to the authenticated user.
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.description, t.fundraiser_id,
              t.due_at, t.status, t.created_at, ta.assigned_at
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.user_id = $1
       ORDER BY t.due_at NULLS LAST, t.created_at DESC`,
      [req.user!.id],
    );

    return res.json({ tasks: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch assigned tasks' });
  }
});

// POST /api/v1/tasks
router.post('/', authenticate, async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid task',
      errors: parsed.error.flatten(),
    });
  }

  const { title, description, fundraiser_id, due_at } = parsed.data;

  try {
    if (fundraiser_id !== undefined && fundraiser_id !== null) {
      const fundraiser = await pool.query(
        `SELECT id FROM fundraisers WHERE id = $1`,
        [fundraiser_id],
      );

      if (!fundraiser.rowCount) {
        return res.status(404).json({ message: 'Fundraiser not found' });
      }
    }

    const result = await pool.query(
      `INSERT INTO tasks
         (title, description, fundraiser_id, due_at, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        title,
        description ?? null,
        fundraiser_id ?? null,
        due_at ?? null,
        req.user!.id,
      ],
    );

    return res.status(201).json({ task: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to create task' });
  }
});

// GET /api/v1/tasks/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.description, t.fundraiser_id,
              t.due_at, t.status, t.created_by, t.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'user_id', u.id,
                    'name', u.name,
                    'assigned_at', ta.assigned_at
                  )
                ) FILTER (WHERE u.id IS NOT NULL),
                '[]'::json
              ) AS assignees
       FROM tasks t
       LEFT JOIN task_assignments ta ON ta.task_id = t.id
       LEFT JOIN users u ON u.id = ta.user_id
       WHERE t.id = $1
       GROUP BY t.id`,
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Task not found' });
    }

    return res.json({ task: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch task' });
  }
});

// PATCH /api/v1/tasks/:id
router.patch('/:id', authenticate, async (req, res) => {
  const parsed = updateTaskSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid task update',
      errors: parsed.error.flatten(),
    });
  }

  const fields = parsed.data;
  const allowed = [
    'title', 'description', 'fundraiser_id', 'due_at', 'status',
  ] as const;

  const updates = allowed.filter((key) =>
    Object.prototype.hasOwnProperty.call(fields, key),
  );

  try {
    if (fields.fundraiser_id !== undefined && fields.fundraiser_id !== null) {
      const fundraiser = await pool.query(
        `SELECT id FROM fundraisers WHERE id = $1`,
        [fields.fundraiser_id],
      );

      if (!fundraiser.rowCount) {
        return res.status(404).json({ message: 'Fundraiser not found' });
      }
    }

    const values = updates.map((key) => fields[key]);
    const assignments = updates.map(
      (key, index) => `${key} = $${index + 1}`,
    );

    const result = await pool.query(
      `UPDATE tasks
       SET ${assignments.join(', ')}
       WHERE id = $${values.length + 1}
       RETURNING *`,
      [...values, req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Task not found' });
    }

    return res.json({ task: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to update task' });
  }
});

// PUT /api/v1/tasks/:id/assignments
// Replace the task's entire assignment list with the supplied user IDs.
router.put('/:id/assignments', authenticate, async (req, res) => {
  const parsed = assignTaskSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid assignments',
      errors: parsed.error.flatten(),
    });
  }

  const userIds = [...new Set(parsed.data.user_ids)];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const task = await client.query(
      `SELECT id FROM tasks WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );

    if (!task.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Task not found' });
    }

    const users = await client.query(
      `SELECT id FROM users
       WHERE is_active = TRUE AND id = ANY($1::bigint[])`,
      [userIds],
    );

    if (users.rowCount !== userIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'One or more users do not exist or are inactive',
      });
    }

    await client.query(
      `DELETE FROM task_assignments WHERE task_id = $1`,
      [req.params.id],
    );

    for (const userId of userIds) {
      await client.query(
        `INSERT INTO task_assignments (task_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (task_id, user_id) DO NOTHING`,
        [req.params.id, userId],
      );
    }

    await client.query('COMMIT');

    return res.json({
      message: 'Task assignments updated',
      task_id: req.params.id,
      assigned_user_ids: userIds,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Failed to assign task' });
  } finally {
    client.release();
  }
});

// DELETE /api/v1/tasks/:id/assignments/:userId
router.delete('/:id/assignments/:userId', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM task_assignments
       WHERE task_id = $1 AND user_id = $2
       RETURNING task_id, user_id`,
      [req.params.id, req.params.userId],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    return res.json({
      message: 'User removed from task',
      assignment: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to remove assignment' });
  }
});

export default router;

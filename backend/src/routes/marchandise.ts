
import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';
import {createProductSchema,updateProductSchema,createVariantSchema,updateVariantSchema,createMerchandiseOrderSchema} 
from "../validation/merchandise.schema.js"

const router = Router();

// GET /api/v1/merchandise/products
router.get('/products', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.description, p.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', v.id,
                    'sku', v.sku,
                    'size', v.size,
                    'price', v.price,
                    'stock_quantity', v.stock_quantity
                  )
                ) FILTER (WHERE v.id IS NOT NULL),
                '[]'::json
              ) AS variants
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id
       WHERE p.is_active = TRUE
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
    );

    return res.json({ products: result.rows });
  } 
  catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch products' });
  }
});

// GET /api/v1/merchandise/products/:id
router.get('/products/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.description,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', v.id,
                    'sku', v.sku,
                    'size', v.size,
                    'price', v.price,
                    'stock_quantity', v.stock_quantity
                  )
                ) FILTER (WHERE v.id IS NOT NULL),
                '[]'::json
              ) AS variants
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id
       WHERE p.id = $1 AND p.is_active = TRUE
       GROUP BY p.id`,
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Product not found' });
    }

    return res.json({ product: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch product' });
  }
});

// POST /api/v1/merchandise/products
router.post('/products', authenticate, async (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid product',
      errors: parsed.error.flatten(),
    });
  }

  try {
    const { name, description } = parsed.data;
    const result = await pool.query(
      `INSERT INTO products (name, description)
       VALUES ($1, $2)
       RETURNING *`,
      [name, description ?? null],
    );

    return res.status(201).json({ product: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to create product' });
  }
});

// PATCH /api/v1/merchandise/products/:id
router.patch('/products/:id', authenticate, async (req, res) => {
  const parsed = updateProductSchema.safeParse(req.body);

  if (!parsed.success || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      message: 'Invalid update data',
      errors: parsed.success ? undefined : parsed.error.flatten(),
    });
  }

  const fields = parsed.data;
  const allowed = ['name', 'description', 'is_active'] as const;
  const updates = allowed.filter((key) =>
    Object.prototype.hasOwnProperty.call(fields, key),
  );

  try {
    const values = updates.map((key) => fields[key]);
    const assignments = updates.map(
      (key, index) => `${key} = $${index + 1}`,
    );

    const result = await pool.query(
      `UPDATE products SET ${assignments.join(', ')}
       WHERE id = $${values.length + 1}
       RETURNING *`,
      [...values, req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Product not found' });
    }

    return res.json({ product: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to update product' });
  }
});

// POST /api/v1/merchandise/products/:id/variants
router.post('/products/:id/variants', authenticate, async (req, res) => {
  const parsed = createVariantSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid variant',
      errors: parsed.error.flatten(),
    });
  }

  try {
    const product = await pool.query(
      `SELECT id FROM products WHERE id = $1`,
      [req.params.id],
    );

    if (!product.rowCount) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const { sku, size, price, stock_quantity } = parsed.data;

    const result = await pool.query(
      `INSERT INTO product_variants
         (product_id, sku, size, price, stock_quantity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, sku, size, price, stock_quantity],
    );

    return res.status(201).json({ variant: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({
        message: 'SKU must be unique, and size must be unique per product',
      });
    }
    console.error(error);
    return res.status(500).json({ message: 'Failed to create variant' });
  }
});

// PATCH /api/v1/merchandise/variants/:id
router.patch('/variants/:id', authenticate, async (req, res) => {
  const parsed = updateVariantSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid variant update',
      errors: parsed.error.flatten(),
    });
  }

  const fields = parsed.data;
  const allowed = ['sku', 'size', 'price', 'stock_quantity'] as const;
  const updates = allowed.filter((key) =>
    Object.prototype.hasOwnProperty.call(fields, key),
  );

  try {
    const values = updates.map((key) => fields[key]);
    const assignments = updates.map(
      (key, index) => `${key} = $${index + 1}`,
    );

    const result = await pool.query(
      `UPDATE product_variants
       SET ${assignments.join(', ')}
       WHERE id = $${values.length + 1}
       RETURNING *`,
      [...values, req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Variant not found' });
    }

    return res.json({ variant: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({
        message: 'SKU or product-size combination already exists',
      });
    }
    console.error(error);
    return res.status(500).json({ message: 'Failed to update variant' });
  }
});

// POST /api/v1/merchandise/orders
router.post('/orders', authenticate, async (req, res) => {
  const parsed = createMerchandiseOrderSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid order',
      errors: parsed.error.flatten(),
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock variant rows in ascending ID order to reduce deadlock risk.
    const sortedItems = [...parsed.data.items].sort(
      (a, b) => a.product_variant_id - b.product_variant_id,
    );

    const variants = [];

    for (const item of sortedItems) {
      const result = await client.query(
        `SELECT v.id, v.price, v.stock_quantity, p.is_active
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         WHERE v.id = $1
         FOR UPDATE OF v`,
        [item.product_variant_id],
      );

      if (!result.rowCount || !result.rows[0].is_active) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          message: `Active product variant ${item.product_variant_id} not found`,
        });
      }

      const variant = result.rows[0];

      if (variant.stock_quantity < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: `Insufficient stock for variant ${item.product_variant_id}`,
        });
      }

      variants.push({
        id: item.product_variant_id,
        quantity: item.quantity,
        price: Number(variant.price),
      });
    }

    const totalAmount = variants.reduce(
      (total, variant) => total + variant.price * variant.quantity,
      0,
    );

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, status, total_amount)
       VALUES ($1, 'pending', $2)
       RETURNING id, user_id, status, total_amount, created_at`,
      [req.user!.id, totalAmount],
    );

    const order = orderResult.rows[0];

    for (const item of variants) {
      await client.query(
        `INSERT INTO order_items
           (order_id, product_variant_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [order.id, item.id, item.quantity, item.price],
      );

      await client.query(
        `UPDATE product_variants
         SET stock_quantity = stock_quantity - $1
         WHERE id = $2`,
        [item.quantity, item.id],
      );
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Order created; payment is pending',
      order,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Failed to create order' });
  } finally {
    client.release();
  }
});

// GET /api/v1/merchandise/orders/me
router.get('/orders/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'variant_id', oi.product_variant_id,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price,
                    'sku', v.sku,
                    'size', v.size,
                    'product_name', p.name
                  )
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'::json
              ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN product_variants v ON v.id = oi.product_variant_id
       LEFT JOIN products p ON p.id = v.product_id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [req.user!.id],
    );

    return res.json({ orders: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// POST /api/v1/merchandise/orders/:id/cancel
router.post('/orders/:id/cancel', authenticate, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT id, status
       FROM orders
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [req.params.id, req.user!.id],
    );

    if (!orderResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Order not found' });
    }

    if (orderResult.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Only pending orders can be cancelled',
      });
    }

    const itemsResult = await client.query(
      `SELECT product_variant_id, quantity
       FROM order_items
       WHERE order_id = $1
       ORDER BY product_variant_id`,
      [req.params.id],
    );

    // Lock variants in consistent order before restoring stock.
    for (const item of itemsResult.rows) {
      await client.query(
        `UPDATE product_variants
         SET stock_quantity = stock_quantity + $1
         WHERE id = $2`,
        [item.quantity, item.product_variant_id],
      );
    }

    const updated = await client.query(
      `UPDATE orders SET status = 'cancelled'
       WHERE id = $1
       RETURNING id, status, total_amount`,
      [req.params.id],
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Order cancelled and stock restored',
      order: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Failed to cancel order' });
  } finally {
    client.release();
  }
});

export default router;

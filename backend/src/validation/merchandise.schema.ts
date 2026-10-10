
import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const updateProductSchema = createProductSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const createVariantSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  size: z.string().trim().min(1).max(50),
  price: z.number().nonnegative(),
  stock_quantity: z.number().int().nonnegative(),
});

export const updateVariantSchema = z.object({
  sku: z.string().trim().min(1).max(100).optional(),
  size: z.string().trim().min(1).max(50).optional(),
  price: z.number().nonnegative().optional(),
  stock_quantity: z.number().int().nonnegative().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one field to update',
});

export const createMerchandiseOrderSchema = z.object({
  items: z.array(z.object({
    product_variant_id: z.number().int().positive(),
    quantity: z.number().int().min(1).max(20),
  })).min(1).max(20),
})
.refine(
  (data) =>
    new Set(data.items.map((item) => item.product_variant_id)).size ===
    data.items.length,
  { message: 'Each product variant may appear only once per order' },
);

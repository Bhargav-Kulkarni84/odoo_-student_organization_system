
import { z } from 'zod';

export const createPaymentSchema = z.object({
  reference_type: z.enum(['membership', 'ticket_order', 'order']),
  reference_id: z.number().int().positive(),
});

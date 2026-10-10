import { z } from 'zod';

const ticketTypeBase = z.object({
  name: z.string().trim().min(1).max(100),
  member_price: z.number().nonnegative(),
  non_member_price: z.number().nonnegative(),
  quantity_available: z.number().int().nonnegative(),
  sales_start: z.iso.datetime({ offset: true }).nullable().optional(),
  sales_end: z.iso.datetime({ offset: true }).nullable().optional(),
});

const salesWindowValid = (data: {
  sales_start?: string | null;
  sales_end?: string | null;
}) =>
  !data.sales_start ||
  !data.sales_end ||
  new Date(data.sales_end) > new Date(data.sales_start);

const salesWindowError = {
  message: 'sales_end must be after sales_start',
  path: ['sales_end'],
};

export const createTicketTypeSchema = ticketTypeBase.refine(
  salesWindowValid,
  salesWindowError
);

export const updateTicketTypeSchema = ticketTypeBase
  .partial()
  .refine(salesWindowValid, salesWindowError)
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const bookTicketsSchema = z.object({
  ticket_type_id: z.number().int().positive(),
  quantity: z.number().int().min(1).max(10),
  attendee_names: z.array(z.string().trim().min(1).max(120))
    .max(10)
    .optional(),
}).refine(
  (data) =>
    !data.attendee_names ||
    data.attendee_names.length === data.quantity,
  { message: 'Provide one attendee name per ticket' }
);

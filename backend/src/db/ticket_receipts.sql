ALTER TABLE ticket_orders
ADD COLUMN IF NOT EXISTS receipt_path TEXT;

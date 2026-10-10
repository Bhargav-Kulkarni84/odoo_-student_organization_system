BEGIN;

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE roles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(40) NOT NULL UNIQUE
);

CREATE TABLE user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE membership_plans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    benefits JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE memberships (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan_id BIGINT NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date >= start_date)
);
CREATE INDEX idx_memberships_user_dates ON memberships(user_id, start_date, end_date);

CREATE TABLE events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    description TEXT,
    location VARCHAR(255),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
    organizer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

CREATE TABLE ticket_types (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    member_price NUMERIC(12,2) NOT NULL CHECK (member_price >= 0),
    non_member_price NUMERIC(12,2) NOT NULL CHECK (non_member_price >= 0),
    quantity_available INTEGER NOT NULL CHECK (quantity_available >= 0),
    sales_start TIMESTAMPTZ,
    sales_end TIMESTAMPTZ,
    UNIQUE (event_id, name),
    CHECK (sales_end IS NULL OR sales_start IS NULL OR sales_end > sales_start)
);

CREATE TABLE ticket_orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tickets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_order_id BIGINT NOT NULL REFERENCES ticket_orders(id) ON DELETE RESTRICT,
    ticket_type_id BIGINT NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT,
    price_paid NUMERIC(12,2) NOT NULL CHECK (price_paid >= 0),
    attendee_name VARCHAR(120),
    ticket_code UUID NOT NULL UNIQUE,
    checked_in_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tickets_type ON tickets(ticket_type_id);

CREATE TABLE products (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE product_variants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    sku VARCHAR(80) NOT NULL UNIQUE,
    size VARCHAR(20) NOT NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    UNIQUE (product_id, size)
);

CREATE TABLE orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE order_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    product_variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    UNIQUE (order_id, product_variant_id)
);

CREATE TABLE announcements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    body TEXT NOT NULL,
    published_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE announcement_recipients (
    announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
    sent_at TIMESTAMPTZ,
    PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE fundraisers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    target_amount NUMERIC(12,2) CHECK (target_amount IS NULL OR target_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE tasks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fundraiser_id BIGINT REFERENCES fundraisers(id) ON DELETE SET NULL,
    title VARCHAR(180) NOT NULL,
    description TEXT,
    due_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE task_assignments (
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
);

CREATE TABLE expenses (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    submitted_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    receipt_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'approved', 'rejected', 'reimbursed')),
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reimbursed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A payment can belong to exactly one membership, ticket order, or merchandise order.
-- Provider references and idempotency keys help avoid duplicate processing.
CREATE TABLE payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    membership_id BIGINT REFERENCES memberships(id) ON DELETE RESTRICT,
    ticket_order_id BIGINT REFERENCES ticket_orders(id) ON DELETE RESTRICT,
    order_id BIGINT REFERENCES orders(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
    provider VARCHAR(50),
    provider_reference VARCHAR(255) UNIQUE,
    idempotency_key VARCHAR(255) UNIQUE,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (membership_id IS NOT NULL)::integer +
        (ticket_order_id IS NOT NULL)::integer +
        (order_id IS NOT NULL)::integer = 1
    )
);

-- Append-oriented record of money received or spent. source_type/source_id identify
-- the originating payment or expense; the application must validate that reference.
CREATE TABLE financial_transactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_type VARCHAR(30) NOT NULL
        CHECK (transaction_type IN (
            'membership_income', 'ticket_income', 'merchandise_income',
            'fundraiser_income', 'expense', 'reimbursement', 'adjustment'
        )),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('inflow', 'outflow')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    description TEXT NOT NULL,
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_type VARCHAR(30) NOT NULL,
    source_id BIGINT NOT NULL,
    recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_financial_transactions_date ON financial_transactions(transaction_date);
CREATE INDEX idx_financial_transactions_source ON financial_transactions(source_type, source_id);

-- Common lookup indexes
CREATE INDEX idx_events_starts_at ON events(starts_at);
CREATE INDEX idx_ticket_orders_user ON ticket_orders(user_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_announcements_status_published ON announcements(status, published_at);

-- Starter roles
INSERT INTO roles (name) VALUES
    ('MEMBER'), ('VOLUNTEER'), ('TREASURER'), ('ADMIN')
ON CONFLICT (name) DO NOTHING;

COMMIT;


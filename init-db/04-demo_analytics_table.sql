-- Physical demo table for PostgreSQL NL→SQL→execute tests.
-- Matches catalog seed table_metadata: analytics.public.sales_summary

CREATE TABLE IF NOT EXISTS public.sales_summary (
    summary_date DATE NOT NULL,
    department VARCHAR(100) NOT NULL,
    total_amount NUMERIC(14, 2) NOT NULL,
    order_count INTEGER NOT NULL,
    avg_amount NUMERIC(14, 2)
);

-- Idempotent refresh for local dev
TRUNCATE public.sales_summary;

INSERT INTO public.sales_summary (summary_date, department, total_amount, order_count, avg_amount) VALUES
    ('2026-01-05', '华东', 12000.00, 40, 300.00),
    ('2026-01-20', '华东', 8000.00, 25, 320.00),
    ('2026-01-10', '华北', 5000.00, 20, 250.00),
    ('2026-02-03', '华东', 15000.00, 50, 300.00),
    ('2026-02-15', '华北', 9000.00, 30, 300.00),
    ('2026-03-01', '华东', 11000.00, 35, 314.29),
    ('2026-03-22', '华北', 7000.00, 28, 250.00);

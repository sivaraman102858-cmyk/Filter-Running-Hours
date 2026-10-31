# Machine Timer — Setup Guide

A real-time, mobile-first machine runtime tracker backed by **Supabase**.

---

## 1. Create the Supabase Table

Go to your **Supabase Dashboard → SQL Editor** and run the following SQL:

```sql
-- Create the machine_timers table
CREATE TABLE IF NOT EXISTS public.machine_timers (
    id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    machine_name TEXT        NOT NULL,
    start_time   TIMESTAMPTZ NOT NULL,
    batch_number TEXT,
    is_running   BOOLEAN     DEFAULT TRUE,
    stopped_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast active-timer lookups
CREATE INDEX IF NOT EXISTS idx_mt_running
    ON public.machine_timers (machine_name, is_running);

-- Enable Row Level Security
ALTER TABLE public.machine_timers ENABLE ROW LEVEL SECURITY;

-- Allow full access for the anon key (required for the app to work)
CREATE POLICY "anon_all" ON public.machine_timers
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Enable Realtime on this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.machine_timers;
```

---

## 2. Open the App

Open `index.html` in your browser — or serve it locally:

```bash
# Using Python (any OS)
python -m http.server 8080

# Then open:
# http://localhost:8080
```

---

## 3. Machine / Filter Reference

| # | Name   | Batch Required | Purpose              |
|---|--------|----------------|----------------------|
| 1 | M1     | No             | Running hours counter |
| 2 | M2     | No             | Running hours counter |
| 3 | M3     | No             | Running hours counter |
| 4 | M4     | No             | Running hours counter |
| 5 | PP1    | Yes            | Batch timer           |
| 6 | PP2    | Yes            | Batch timer           |
| 7 | PP Old | Yes            | Batch timer           |

---

## 4. How It Works

- **Start Timer**: Tap a card → enter date/time (+ batch for PP) → confirm
- **Stop Timer**: Tap the red "Stop Timer" button on any running card
- **Real-time Sync**: All devices see the same state instantly via Supabase Realtime
- **Persistent**: Timers survive page reloads — state is stored in the database

---

## Supabase Credentials

| Field | Value |
|-------|-------|
| Project URL | `https://juesyugrdozfibwdsupu.supabase.co` |
| Anon Key | `sb_publishable_NIaqex1976z_zs5EEVgKAg_SCh4BNla` |

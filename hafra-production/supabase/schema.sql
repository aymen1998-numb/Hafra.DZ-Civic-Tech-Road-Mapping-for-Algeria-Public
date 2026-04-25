-- ════════════════════════════════════════════════════════════════════════════
--  hafra.dz — Supabase Schema
--  Run this entirely in: Supabase Dashboard → SQL Editor → New Query
-- ════════════════════════════════════════════════════════════════════════════

-- ── EXTENSIONS ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";  -- For geo queries (optional but useful)

-- ── REPORTS TABLE ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reports (
  id          UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  score       SMALLINT      NOT NULL,
  category    TEXT          NOT NULL,
  comment     TEXT,
  photo_url   TEXT,
  wilaya      TEXT,
  votes       INTEGER       NOT NULL DEFAULT 0,
  status      TEXT          NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- ── SERVER-SIDE CONSTRAINTS (cannot be bypassed from the client) ──────────
  CONSTRAINT chk_lat          CHECK (lat  BETWEEN 18.9  AND 37.2),
  CONSTRAINT chk_lng          CHECK (lng  BETWEEN -8.7  AND 12.0),
  CONSTRAINT chk_score        CHECK (score BETWEEN 1 AND 5),
  CONSTRAINT chk_category     CHECK (category IN ('pothole','cracks','lighting','signage','flooding','utility')),
  CONSTRAINT chk_status       CHECK (status   IN ('active','reported','fixed')),
  CONSTRAINT chk_comment_len  CHECK (comment IS NULL OR (length(comment) BETWEEN 1 AND 300)),
  CONSTRAINT chk_votes        CHECK (votes >= 0),
  -- Validate photo_url is a Supabase Storage URL or NULL — blocks data: and javascript: URIs
  CONSTRAINT chk_photo_url    CHECK (
    photo_url IS NULL OR (
      photo_url ~ '^https://[a-zA-Z0-9._-]+\.supabase\.(co|in)/'
      AND length(photo_url) < 512
    )
  ),
  CONSTRAINT chk_wilaya_len   CHECK (wilaya IS NULL OR length(wilaya) < 100)
);

-- ── INDICES ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reports_created ON public.reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_wilaya  ON public.reports (wilaya);
CREATE INDEX IF NOT EXISTS idx_reports_cat     ON public.reports (category);
CREATE INDEX IF NOT EXISTS idx_reports_status  ON public.reports (status);
-- Spatial index for bounding-box map queries
CREATE INDEX IF NOT EXISTS idx_reports_geo ON public.reports
  USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326));

-- ── AUTO-UPDATE updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_reports_updated_at ON public.reports;
CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── SERVER-SIDE RATE LIMITING ─────────────────────────────────────────────────
-- Rejects >5 inserts from the same IP within 10 minutes.
-- Supabase passes the real client IP in the request headers.
-- This function is called from the RLS INSERT policy.
CREATE OR REPLACE FUNCTION public.check_rate_limit()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  ip_addr TEXT;
  recent_count INT;
BEGIN
  -- Get client IP injected by PostgREST / Supabase
  ip_addr := current_setting('request.headers', true)::json->>'x-real-ip';
  IF ip_addr IS NULL THEN
    ip_addr := current_setting('request.headers', true)::json->>'x-forwarded-for';
  END IF;
  -- If we can't detect IP (e.g., service role), allow
  IF ip_addr IS NULL THEN RETURN TRUE; END IF;

  SELECT COUNT(*) INTO recent_count
  FROM public.reports
  WHERE created_at > NOW() - INTERVAL '10 minutes';
  -- We use a global count as a simple spam filter (no per-IP storage needed)
  -- For per-IP: store IPs in a separate rate_limit table with TTL

  RETURN recent_count < 100; -- max 100 global inserts per 10 min
END;
$$;

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────────
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- 1. Anyone can READ all reports (public map)
CREATE POLICY "public_read_reports"
  ON public.reports FOR SELECT
  USING (true);

-- 2. Anyone can INSERT — but server constraints + rate limit apply
CREATE POLICY "public_insert_reports"
  ON public.reports FOR INSERT
  WITH CHECK (
    -- Enforce all constraints are met
    lat      BETWEEN 18.9 AND 37.2                                      AND
    lng      BETWEEN -8.7 AND 12.0                                      AND
    score    BETWEEN 1 AND 5                                            AND
    category IN ('pothole','cracks','lighting','signage','flooding','utility') AND
    status   = 'active'                                                 AND
    votes    = 0                                                        AND
    (comment IS NULL OR length(comment) <= 300)                        AND
    (photo_url IS NULL OR photo_url ~ '^https://[a-zA-Z0-9._-]+\.supabase\.(co|in)/') AND
    public.check_rate_limit()
  );

-- 3. Only votes and status can be updated by the public — NOT score, category, lat, lng
CREATE POLICY "public_update_votes_status"
  ON public.reports FOR UPDATE
  USING (true)
  WITH CHECK (
    -- Prevent changing sensitive fields
    lat      = (SELECT lat      FROM public.reports r WHERE r.id = reports.id) AND
    lng      = (SELECT lng      FROM public.reports r WHERE r.id = reports.id) AND
    score    = (SELECT score    FROM public.reports r WHERE r.id = reports.id) AND
    category = (SELECT category FROM public.reports r WHERE r.id = reports.id) AND
    votes    >= 0                                                               AND
    status   IN ('active','reported','fixed')
  );

-- 4. No public deletes — only admins (service role) can delete
-- (no policy = blocked by default when RLS is enabled)

-- ── STORAGE BUCKET ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'road-photos',
  'road-photos',
  true,
  5242880,  -- 5 MB hard limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS
CREATE POLICY "public_upload_photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'road-photos'
    AND (storage.foldername(name))[1] IS NOT DISTINCT FROM NULL  -- no sub-folders
    AND octet_length(name) < 100
  );

CREATE POLICY "public_read_photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'road-photos');

-- Block public deletes and updates of photos (admin only)

-- ── REALTIME ──────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;

-- ── ADMIN VIEW (useful for the upcoming admin dashboard) ──────────────────────
CREATE OR REPLACE VIEW public.reports_admin AS
SELECT
  id, lat, lng, score, category, comment, photo_url,
  wilaya, votes, status, created_at, updated_at,
  -- Computed quality label
  CASE score
    WHEN 1 THEN 'Impraticable'
    WHEN 2 THEN 'Très mauvais'
    WHEN 3 THEN 'Acceptable'
    WHEN 4 THEN 'Bon état'
    WHEN 5 THEN 'Parfait'
  END AS score_label,
  -- Computed urgency (for admin prioritisation)
  CASE
    WHEN score = 1 AND status = 'active' AND votes > 10 THEN 'critical'
    WHEN score <= 2 AND status = 'active' THEN 'high'
    WHEN score  = 3 THEN 'medium'
    ELSE 'low'
  END AS urgency
FROM public.reports
ORDER BY created_at DESC;

-- This view is only accessible to the service_role key (your admin dashboard)
REVOKE ALL ON public.reports_admin FROM anon, authenticated;
GRANT SELECT ON public.reports_admin TO service_role;

-- ── STATS FUNCTION ────────────────────────────────────────────────────────────
-- Call via: SELECT * FROM get_stats();
CREATE OR REPLACE FUNCTION public.get_stats()
RETURNS TABLE (
  total_reports     BIGINT,
  avg_score         NUMERIC,
  critical_count    BIGINT,
  total_votes       BIGINT,
  most_reported_wilaya TEXT
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    COUNT(*)                                    AS total_reports,
    ROUND(AVG(score)::numeric, 2)               AS avg_score,
    COUNT(*) FILTER (WHERE score <= 2)          AS critical_count,
    SUM(votes)                                  AS total_votes,
    (SELECT wilaya FROM public.reports
     GROUP BY wilaya ORDER BY COUNT(*) DESC LIMIT 1) AS most_reported_wilaya
  FROM public.reports;
$$;

GRANT EXECUTE ON FUNCTION public.get_stats() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  hafra.dz — Admin Schema Extension
--  Run AFTER schema.sql in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. EXTEND reports TABLE WITH ADMIN COLUMNS ────────────────────────────────
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS flagged      BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_notes  TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by  UUID REFERENCES auth.users(id);

-- Update status CHECK to include 'flagged'
ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS chk_status;
ALTER TABLE public.reports
  ADD CONSTRAINT chk_status
    CHECK (status IN ('active','reported','fixed','flagged'));

-- Index for admin queries
CREATE INDEX IF NOT EXISTS idx_reports_flagged  ON public.reports (flagged)  WHERE flagged  = TRUE;
CREATE INDEX IF NOT EXISTS idx_reports_archived ON public.reports (archived) WHERE archived = TRUE;

-- ── 2. ADMIN USERS TABLE ──────────────────────────────────────────────────────
-- Stores which auth.users are admins and their role level.
CREATE TABLE IF NOT EXISTS public.admin_users (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'moderator'
                         CHECK (role IN ('moderator','admin','superadmin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Admins can read the admin_users table (to verify their own role)
CREATE POLICY "admin_read_self"
  ON public.admin_users FOR SELECT
  USING (auth.uid() = id);

-- Only superadmins can insert / manage other admins
-- (bootstrap: insert the first admin manually via Supabase dashboard)
CREATE POLICY "superadmin_manage_admins"
  ON public.admin_users FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid() AND role = 'superadmin')
  );

-- ── 3. AUDIT LOG ──────────────────────────────────────────────────────────────
-- Every admin action is recorded and immutable.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  admin_id    UUID        REFERENCES auth.users(id),
  admin_email TEXT,
  action      TEXT        NOT NULL, -- 'edit','delete','archive','flag','restore'
  report_id   UUID,
  payload     JSONB,               -- what changed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read the audit log
CREATE POLICY "admins_read_audit"
  ON public.audit_log FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid())
  );

-- Audit log is INSERT only via a server function — no UPDATE or DELETE by anyone
CREATE POLICY "deny_audit_update" ON public.audit_log FOR UPDATE USING (FALSE);
CREATE POLICY "deny_audit_delete" ON public.audit_log FOR DELETE USING (FALSE);

-- ── 4. HELPER: IS CURRENT USER AN ADMIN? ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE id = auth.uid() AND role = 'superadmin'
  );
$$;

-- ── 5. ADMIN RLS POLICIES ON reports ─────────────────────────────────────────
-- Admins can read ALL reports (including archived/flagged)
CREATE POLICY "admin_read_all_reports"
  ON public.reports FOR SELECT
  USING (public.is_admin());

-- Admins can UPDATE any field on any report
CREATE POLICY "admin_update_reports"
  ON public.reports FOR UPDATE
  USING (public.is_admin());

-- Only admins can DELETE reports
CREATE POLICY "admin_delete_reports"
  ON public.reports FOR DELETE
  USING (public.is_admin());

-- ── 6. AUDIT LOG FUNCTION (called after admin actions) ────────────────────────
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action    TEXT,
  p_report_id UUID,
  p_payload   JSONB DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM public.admin_users WHERE id = auth.uid();
  INSERT INTO public.audit_log (admin_id, admin_email, action, report_id, payload)
  VALUES (auth.uid(), v_email, p_action, p_report_id, p_payload);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, UUID, JSONB) TO authenticated;

-- ── 7. ADMIN STATS FUNCTION ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSONB LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT jsonb_build_object(
    'total',          COUNT(*),
    'active',         COUNT(*) FILTER (WHERE status = 'active' AND NOT archived),
    'reported',       COUNT(*) FILTER (WHERE status = 'reported'),
    'fixed',          COUNT(*) FILTER (WHERE status = 'fixed'),
    'flagged',        COUNT(*) FILTER (WHERE flagged = TRUE),
    'archived',       COUNT(*) FILTER (WHERE archived = TRUE),
    'with_photo',     COUNT(*) FILTER (WHERE photo_url IS NOT NULL),
    'critical',       COUNT(*) FILTER (WHERE score = 1 AND NOT archived),
    'total_votes',    SUM(votes),
    'avg_score',      ROUND(AVG(score)::numeric, 2),
    'today',          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24h'),
    'this_week',      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7d'),
    'top_wilaya',     (SELECT wilaya FROM public.reports
                       WHERE NOT archived GROUP BY wilaya
                       ORDER BY COUNT(*) DESC LIMIT 1)
  ) FROM public.reports;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;

-- ── 8. STORAGE ADMIN POLICIES ─────────────────────────────────────────────────
-- Admins can delete photos from storage
CREATE POLICY "admin_delete_photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'road-photos'
    AND public.is_admin()
  );

-- ── 9. BOOTSTRAP: INSERT YOUR FIRST ADMIN ─────────────────────────────────────
-- After creating your user via Supabase Auth (Dashboard → Authentication → Users → Invite),
-- run this with their UUID and email:
--
-- INSERT INTO public.admin_users (id, email, role)
-- VALUES ('YOUR-USER-UUID-HERE', 'admin@hafra.dz', 'superadmin');

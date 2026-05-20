-- Table planning: per-event sizing and half-table pairing.
--
-- Vendors request a size when applying for a specific event (half / full /
-- double); staff can change it later from the per-event Tables page. Pairing
-- two half-table vendors with non-overlapping time windows is persisted as
-- a shared table_group_id so the same pair survives reloads.
--
-- All of this is per-event (not per-vendor) because a vendor who wanted one
-- table at the May show might want two at the June show.
--
-- Columns:
--   requested_table_size  How much table the vendor needs at this event.
--                         Defaults to 'tbd' so legacy approved applications
--                         (and vendors who don't pick on the modal) stay
--                         unblocking; staff resolves on the Tables page.
--   table_group_id        Two approved 'half' applications sharing this UUID
--                         share a physical table. Null = not paired yet.

ALTER TABLE public.vendor_applications
  ADD COLUMN IF NOT EXISTS requested_table_size text NOT NULL DEFAULT 'tbd',
  ADD COLUMN IF NOT EXISTS table_group_id uuid;

ALTER TABLE public.vendor_applications
  DROP CONSTRAINT IF EXISTS vendor_applications_table_size_check;

ALTER TABLE public.vendor_applications
  ADD CONSTRAINT vendor_applications_table_size_check
  CHECK (requested_table_size IN ('half', 'full', 'double', 'tbd'));

-- Half-table pairing lookups go through (event_id, table_group_id) so the
-- Tables page can render groups in one pass.
CREATE INDEX IF NOT EXISTS vendor_applications_table_group_idx
  ON public.vendor_applications (event_id, table_group_id)
  WHERE table_group_id IS NOT NULL;

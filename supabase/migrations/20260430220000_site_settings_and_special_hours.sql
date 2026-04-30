-- Editable site config (Visit Us section) + special-hours overrides (holidays).
-- site_settings is a single-row table; we enforce singleton with id=1 CHECK.

CREATE TABLE public.site_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  address_line_1 text,
  address_line_2 text,
  address_subtitle text,
  phone text,
  email text,
  ig_handle text,
  hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER site_settings_set_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.site_settings (id, address_line_1, address_line_2, address_subtitle, phone, email, ig_handle, hours)
VALUES (
  1,
  '4911 Warner Ave #210',
  'Huntington Beach, CA 92649',
  'Located in Harbour Landing',
  '(714) 951-9100',
  'Trainercenter.pokemon@gmail.com',
  'trainercenter.pokemon',
  '{
    "0": {"open": "10:00", "close": "17:00", "theme": "Painting Day"},
    "1": null,
    "2": {"open": "12:00", "close": "20:00", "theme": "Masterset with Larry"},
    "3": {"open": "12:00", "close": "20:00", "theme": "Game Day with Seth"},
    "4": {"open": "12:00", "close": "20:00", "theme": "Consultation with Chef"},
    "5": {"open": "12:00", "close": "22:00", "theme": "Trade Night"},
    "6": {"open": "10:00", "close": "20:00", "theme": "Community Day"}
  }'::jsonb
);

CREATE TABLE public.special_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date date NOT NULL,
  end_date date NOT NULL,
  closed boolean NOT NULL DEFAULT true,
  open_time time,
  close_time time,
  title text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (closed = true OR (open_time IS NOT NULL AND close_time IS NOT NULL))
);

CREATE INDEX special_hours_dates_idx ON public.special_hours(start_date, end_date);

CREATE TRIGGER special_hours_set_updated_at
  BEFORE UPDATE ON public.special_hours
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view site settings"
  ON public.site_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can update site settings"
  ON public.site_settings FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

ALTER TABLE public.special_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view special hours"
  ON public.special_hours FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage special hours"
  ON public.special_hours FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

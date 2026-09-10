-- Public, privacy-safe capacity summaries for delivered alternatives.
-- These aggregates intentionally have no resource, booking, or project IDs.

ALTER TABLE IF EXISTS ag.leistungsantwort_alternativen
  ADD COLUMN IF NOT EXISTS resource_mix JSONB;

ALTER TABLE IF EXISTS an.an_leistungsantwort_alternativen
  ADD COLUMN IF NOT EXISTS resource_mix JSONB;

ALTER TABLE IF EXISTS public.leistungsantwort_alternativen
  ADD COLUMN IF NOT EXISTS resource_mix JSONB;

ALTER TABLE IF EXISTS public.an_leistungsantwort_alternativen
  ADD COLUMN IF NOT EXISTS resource_mix JSONB;
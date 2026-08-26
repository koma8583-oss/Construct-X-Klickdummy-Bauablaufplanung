ALTER TABLE an_project_invitations
  ADD COLUMN IF NOT EXISTS data_offer_snapshot jsonb;
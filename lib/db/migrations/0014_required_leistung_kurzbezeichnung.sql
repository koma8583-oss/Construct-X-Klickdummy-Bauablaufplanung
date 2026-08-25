-- Every Leistung has a compact identifier for cross-system/data-space display.
ALTER TABLE leistungen ADD COLUMN IF NOT EXISTS kurzbezeichnung text DEFAULT '';
UPDATE leistungen
SET kurzbezeichnung = leistungs_bezeichnung
WHERE kurzbezeichnung IS NULL;
ALTER TABLE leistungen ALTER COLUMN kurzbezeichnung SET NOT NULL;
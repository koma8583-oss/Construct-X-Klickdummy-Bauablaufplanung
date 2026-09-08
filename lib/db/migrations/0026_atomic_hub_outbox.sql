-- Atomic cross-schema outbox bridge.
--
-- AG and AN keep their table-level isolation from Hub.  This narrowly scoped
-- SECURITY DEFINER function lets a domain transaction insert its Hub outbox
-- envelope on the same PostgreSQL connection/transaction without granting
-- either domain role access to hub.message_outbox.

CREATE OR REPLACE FUNCTION hub.enqueue_outbox_message(
  p_message_id text,
  p_schema_version text,
  p_message_type text,
  p_sender_org_id text,
  p_recipient_org_id text,
  p_correlation_id text,
  p_causation_id text,
  p_payload jsonb,
  p_status text DEFAULT 'PENDING'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hub, pg_catalog
AS $$
BEGIN
  INSERT INTO message_outbox (
    id,
    message_id,
    schema_version,
    message_type,
    sender_org_id,
    recipient_org_id,
    correlation_id,
    causation_id,
    payload,
    status
  )
  VALUES (
    p_message_id,
    p_message_id,
    p_schema_version,
    p_message_type::public.dataspace_message_type,
    p_sender_org_id,
    p_recipient_org_id,
    p_correlation_id,
    p_causation_id,
    p_payload,
    p_status::public.dataspace_message_status
  )
  ON CONFLICT (message_id) DO NOTHING;

  RETURN p_message_id;
END;
$$;

REVOKE ALL ON FUNCTION hub.enqueue_outbox_message(
  text, text, text, text, text, text, text, jsonb, text
) FROM PUBLIC;

-- USAGE does not grant table access.  It only permits calling the explicitly
-- granted function; direct SELECT/INSERT on Hub tables remains revoked.
GRANT USAGE ON SCHEMA hub TO taktkoord_ag, taktkoord_an;
GRANT EXECUTE ON FUNCTION hub.enqueue_outbox_message(
  text, text, text, text, text, text, text, jsonb, text
) TO taktkoord_ag, taktkoord_an;
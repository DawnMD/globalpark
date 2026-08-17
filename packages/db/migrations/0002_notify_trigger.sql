-- D3/D7: the outbox mechanism. Every parking_event insert fires a
-- pg_notify carrying only id + topic + kind -- never the full payload.
-- NOTIFY has an 8KB cap and no delivery guarantee (D3b); the SSE route
-- treats this purely as an invalidation hint and replays from
-- parking_event using Last-Event-ID, not from the NOTIFY payload itself.
CREATE OR REPLACE FUNCTION notify_parking_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'parking_events',
    json_build_object('id', NEW.id, 'topic', NEW.topic, 'kind', NEW.kind)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER parking_event_notify
  AFTER INSERT ON parking_event
  FOR EACH ROW
  EXECUTE FUNCTION notify_parking_event();

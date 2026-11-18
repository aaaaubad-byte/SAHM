-- Draw scheduling and execution must be available on the final day of the cycle, not the day after.
DO $$
DECLARE
  v_readiness text := pg_get_functiondef('private.get_draw_readiness(uuid)'::regprocedure);
  v_schedule text := pg_get_functiondef('private.set_draw_scheduled_at(uuid,timestamptz)'::regprocedure);
  v_draw text := pg_get_functiondef('private.perform_draw(uuid,integer)'::regprocedure);
  v_room text := pg_get_functiondef('private.get_draw_room(uuid,integer)'::regprocedure);
BEGIN
  IF position('v_cycle.ends_on + 1' in v_readiness) > 0 THEN
    RAISE EXCEPTION 'get_draw_readiness still waits until the day after cycle end';
  END IF;
  IF position('v_due := v_cycle.ends_on;' in v_schedule) = 0 THEN
    RAISE EXCEPTION 'set_draw_scheduled_at does not accept the final cycle day';
  END IF;
  IF position('v_cycle.ends_on + 1' in v_draw) > 0 THEN
    RAISE EXCEPTION 'perform_draw still blocks execution on the final cycle day';
  END IF;
  IF position('''due_on'', v_cycle.ends_on' in v_room) = 0 THEN
    RAISE EXCEPTION 'draw room due_on does not match the final cycle day';
  END IF;
END;
$$;

SELECT 'SAHM final-day draw schedule contract passed' AS result;

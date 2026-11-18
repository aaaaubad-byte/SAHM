-- Allow members to be invited to the draw room and schedule/perform the draw on the final day of the financial cycle.
-- Existing cycle dates and historical draw rows are preserved; only the due-day boundary changes.
DO $migration$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('private.get_draw_readiness(uuid)'::regprocedure);
  v_new := replace(v_def, 'v_cycle.ends_on + 1', 'v_cycle.ends_on');
  IF v_new = v_def THEN RAISE EXCEPTION 'Could not update get_draw_readiness final-day boundary'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('private.set_draw_scheduled_at(uuid,timestamptz)'::regprocedure);
  v_new := replace(v_def, 'v_due := v_cycle.ends_on + 1;', 'v_due := v_cycle.ends_on;');
  IF v_new = v_def THEN RAISE EXCEPTION 'Could not update set_draw_scheduled_at final-day boundary'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('private.perform_draw(uuid,integer)'::regprocedure);
  v_new := replace(v_def, 'v_cycle.ends_on + 1', 'v_cycle.ends_on');
  IF v_new = v_def THEN RAISE EXCEPTION 'Could not update perform_draw final-day boundary'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('private.get_draw_room(uuid,integer)'::regprocedure);
  v_new := replace(v_def, '''due_on'', v_cycle.ends_on + 1', '''due_on'', v_cycle.ends_on');
  IF v_new = v_def THEN RAISE EXCEPTION 'Could not update get_draw_room due_on boundary'; END IF;
  EXECUTE v_new;
END;
$migration$;

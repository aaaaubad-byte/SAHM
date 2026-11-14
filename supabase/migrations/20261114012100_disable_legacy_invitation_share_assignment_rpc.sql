-- Disable the legacy invitation RPC overload that lets managers assign shares.
-- Historical invitation rows and the legacy acceptance RPC remain intact.
REVOKE ALL ON FUNCTION private.create_invitation(uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_invitation(uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;

-- The current invite flow remains available: it has no shares parameter.
GRANT EXECUTE ON FUNCTION public.create_invitation(uuid,text,text)
  TO authenticated;

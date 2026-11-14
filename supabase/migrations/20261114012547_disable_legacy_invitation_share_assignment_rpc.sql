-- Restore the production restriction on the legacy share-assigning invitation RPC.
-- The four-argument overload is retained for compatibility but is not callable by clients.
REVOKE ALL ON FUNCTION private.create_invitation(uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_invitation(uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;

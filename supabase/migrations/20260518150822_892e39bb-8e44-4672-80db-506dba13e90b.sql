ALTER TABLE public.leituras REPLICA IDENTITY FULL;
ALTER TABLE public.inventarios REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='leituras') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.leituras';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='inventarios') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.inventarios';
  END IF;
END $$;
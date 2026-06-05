-- Tratativas de divergência: status de acompanhamento da análise, por SKU em cada inventário.
-- Ausência de linha = "pendente". Só grava linha quando o supervisor define um status.
CREATE TABLE IF NOT EXISTS public.tratativas_divergencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios(id) ON DELETE CASCADE,
  sku text NOT NULL,
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','ajustado','recontar','aceito','investigando')),
  observacao text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inventario_id, sku)
);

CREATE INDEX IF NOT EXISTS tratativas_divergencia_inv_idx
  ON public.tratativas_divergencia (inventario_id);

GRANT SELECT ON public.tratativas_divergencia TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tratativas_divergencia TO authenticated;
GRANT ALL ON public.tratativas_divergencia TO service_role;

ALTER TABLE public.tratativas_divergencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tratativas leitura publica" ON public.tratativas_divergencia;
CREATE POLICY "Tratativas leitura publica"
  ON public.tratativas_divergencia FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Tratativas admin insert" ON public.tratativas_divergencia;
CREATE POLICY "Tratativas admin insert"
  ON public.tratativas_divergencia FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Tratativas admin update" ON public.tratativas_divergencia;
CREATE POLICY "Tratativas admin update"
  ON public.tratativas_divergencia FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Tratativas admin delete" ON public.tratativas_divergencia;
CREATE POLICY "Tratativas admin delete"
  ON public.tratativas_divergencia FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

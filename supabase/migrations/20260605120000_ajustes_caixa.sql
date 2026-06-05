-- Auditoria/backup das correções automáticas de contagem em caixa → unidade.
-- Cada linha guarda o valor original da leitura (quantidade_antiga), tornando o
-- ajuste 100% reversível. UNIQUE(leitura_id) impede aplicar a correção duas vezes.
CREATE TABLE IF NOT EXISTS public.ajustes_caixa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios(id) ON DELETE CASCADE,
  leitura_id uuid NOT NULL REFERENCES public.leituras(id) ON DELETE CASCADE,
  codigo_posicao text NOT NULL,
  codigo_produto text NOT NULL,
  numero_contagem integer NOT NULL,
  quantidade_antiga numeric NOT NULL,
  quantidade_nova numeric NOT NULL,
  embal numeric NOT NULL,
  criterio text NOT NULL,          -- 'vs_wms' | 'vs_contagem'
  aplicado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leitura_id)
);

CREATE INDEX IF NOT EXISTS ajustes_caixa_inv_idx ON public.ajustes_caixa (inventario_id);

GRANT SELECT ON public.ajustes_caixa TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ajustes_caixa TO authenticated;
GRANT ALL ON public.ajustes_caixa TO service_role;

ALTER TABLE public.ajustes_caixa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ajustes caixa leitura publica" ON public.ajustes_caixa;
CREATE POLICY "Ajustes caixa leitura publica"
  ON public.ajustes_caixa FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Ajustes caixa admin insert" ON public.ajustes_caixa;
CREATE POLICY "Ajustes caixa admin insert"
  ON public.ajustes_caixa FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Ajustes caixa admin delete" ON public.ajustes_caixa;
CREATE POLICY "Ajustes caixa admin delete"
  ON public.ajustes_caixa FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

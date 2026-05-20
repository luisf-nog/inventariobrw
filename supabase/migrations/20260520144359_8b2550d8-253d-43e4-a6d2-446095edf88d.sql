CREATE TABLE public.estoque_wms_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios(id) ON DELETE CASCADE,
  codigo_posicao text NOT NULL,
  sku text NOT NULL,
  descricao text,
  qtde_unidades numeric NOT NULL DEFAULT 0,
  qtde_estoque numeric,
  qtde_embal numeric,
  ean text,
  lote text,
  dt_validade timestamptz,
  raw jsonb,
  capturado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX estoque_wms_snapshot_uniq
  ON public.estoque_wms_snapshot (inventario_id, codigo_posicao, sku, COALESCE(lote, ''));

CREATE INDEX estoque_wms_snapshot_inv_pos
  ON public.estoque_wms_snapshot (inventario_id, codigo_posicao);

ALTER TABLE public.estoque_wms_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wms snapshot leitura publica"
  ON public.estoque_wms_snapshot FOR SELECT
  USING (true);

CREATE POLICY "wms snapshot admin insert"
  ON public.estoque_wms_snapshot FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "wms snapshot admin update"
  ON public.estoque_wms_snapshot FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "wms snapshot admin delete"
  ON public.estoque_wms_snapshot FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.inventarios
  ADD COLUMN IF NOT EXISTS wms_sincronizado_em timestamptz;
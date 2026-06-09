CREATE TABLE public.itens_pedidos_sap (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  pedido text,
  descricao text,
  qtde numeric,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_itens_pedidos_sap_sku ON public.itens_pedidos_sap(sku);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.itens_pedidos_sap TO authenticated;
GRANT SELECT ON public.itens_pedidos_sap TO anon;
GRANT ALL ON public.itens_pedidos_sap TO service_role;

ALTER TABLE public.itens_pedidos_sap ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leitura aberta" ON public.itens_pedidos_sap FOR SELECT USING (true);
CREATE POLICY "escrita autenticada" ON public.itens_pedidos_sap FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.itens_pedidos_sap;
ALTER TABLE public.itens_pedidos_sap REPLICA IDENTITY FULL;
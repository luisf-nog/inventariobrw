
-- Cadastro de produtos para tradução de EAN -> SKU/descrição
CREATE TABLE public.produtos (
  sku TEXT PRIMARY KEY,
  descricao TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.produto_eans (
  ean TEXT PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES public.produtos(sku) ON DELETE CASCADE,
  tipo TEXT
);

CREATE INDEX idx_produto_eans_sku ON public.produto_eans(sku);

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produto_eans ENABLE ROW LEVEL SECURITY;

-- Leitura pública (coletor sem auth)
CREATE POLICY "produtos leitura publica" ON public.produtos FOR SELECT USING (true);
CREATE POLICY "produto_eans leitura publica" ON public.produto_eans FOR SELECT USING (true);

-- Escrita apenas admin
CREATE POLICY "produtos admin insert" ON public.produtos FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "produtos admin update" ON public.produtos FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin'));
CREATE POLICY "produtos admin delete" ON public.produtos FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));

CREATE POLICY "produto_eans admin insert" ON public.produto_eans FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "produto_eans admin update" ON public.produto_eans FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin'));
CREATE POLICY "produto_eans admin delete" ON public.produto_eans FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));

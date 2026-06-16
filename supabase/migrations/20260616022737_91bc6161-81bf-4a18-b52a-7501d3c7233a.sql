CREATE TABLE public.conferencias_posicao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_posicao text NOT NULL,
  sku text NOT NULL,
  descricao text,
  lote text,
  qtde_sistema numeric,
  qtde_informada numeric NOT NULL,
  observacao text,
  operador_id uuid REFERENCES public.operadores(id) ON DELETE SET NULL,
  operador_nome text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conferencias_posicao_posicao ON public.conferencias_posicao (codigo_posicao);
CREATE INDEX idx_conferencias_posicao_criado_em ON public.conferencias_posicao (criado_em DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conferencias_posicao TO anon, authenticated;
GRANT ALL ON public.conferencias_posicao TO service_role;

ALTER TABLE public.conferencias_posicao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leitura pública das conferências" ON public.conferencias_posicao FOR SELECT USING (true);
CREATE POLICY "Inserção pública das conferências" ON public.conferencias_posicao FOR INSERT WITH CHECK (true);
CREATE POLICY "Atualização pública das conferências" ON public.conferencias_posicao FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Exclusão pública das conferências" ON public.conferencias_posicao FOR DELETE USING (true);
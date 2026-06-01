CREATE TABLE public.recontagens_solicitadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL,
  codigo_posicao text NOT NULL,
  codigo_produto text NOT NULL,
  numero_contagem_origem integer NOT NULL DEFAULT 1,
  observacao text,
  solicitado_por uuid,
  solicitado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recontagens_inv_idx ON public.recontagens_solicitadas (inventario_id);

GRANT SELECT ON public.recontagens_solicitadas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recontagens_solicitadas TO authenticated;
GRANT ALL ON public.recontagens_solicitadas TO service_role;

ALTER TABLE public.recontagens_solicitadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recontagens leitura publica"
ON public.recontagens_solicitadas
FOR SELECT TO public
USING (true);

CREATE POLICY "Recontagens admin insert"
ON public.recontagens_solicitadas
FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Recontagens admin update"
ON public.recontagens_solicitadas
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Recontagens admin delete"
ON public.recontagens_solicitadas
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- 1. Função server-side para validar PIN (evita exposição e comparação no cliente)
CREATE OR REPLACE FUNCTION public.verificar_pin_operador(
  p_operador_id uuid,
  p_pin text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN pin IS NULL OR pin = '' THEN true
    ELSE pin = p_pin
  END
  FROM public.operadores
  WHERE id = p_operador_id AND ativo = true
  LIMIT 1
$$;

-- 2. Coluna computada tem_pin: expõe apenas se há PIN sem revelar o valor
ALTER TABLE public.operadores
  ADD COLUMN IF NOT EXISTS tem_pin boolean GENERATED ALWAYS AS (pin IS NOT NULL AND pin <> '') STORED;

-- 3. Restringe visibilidade da coluna pin para o role anon (coletores sem auth)
REVOKE SELECT ON public.operadores FROM anon;
GRANT SELECT (id, nome, ativo, tem_pin, created_at) ON public.operadores TO anon;

-- 4. Corrige política DELETE de leituras: era pública, agora exige admin autenticado
DROP POLICY "Leituras delete publica" ON public.leituras;
CREATE POLICY "Leituras delete admin" ON public.leituras
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

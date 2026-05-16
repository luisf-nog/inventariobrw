
-- Roles infrastructure (avoid privilege escalation)
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Operadores
CREATE TABLE public.operadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  pin text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.operadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operadores leitura publica" ON public.operadores
  FOR SELECT USING (true);

CREATE POLICY "Operadores admin insert" ON public.operadores
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Operadores admin update" ON public.operadores
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Operadores admin delete" ON public.operadores
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Inventarios
CREATE TABLE public.inventarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','encerrado')),
  criado_por uuid REFERENCES public.operadores(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  encerrado_em timestamptz
);

ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Inventarios leitura publica" ON public.inventarios
  FOR SELECT USING (true);

CREATE POLICY "Inventarios admin insert" ON public.inventarios
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Inventarios admin update" ON public.inventarios
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Inventarios admin delete" ON public.inventarios
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Leituras
CREATE TABLE public.leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios(id) ON DELETE CASCADE,
  codigo_posicao text NOT NULL,
  codigo_produto text NOT NULL,
  quantidade numeric NOT NULL,
  numero_contagem integer NOT NULL DEFAULT 1,
  operador_id uuid REFERENCES public.operadores(id),
  lido_em timestamptz NOT NULL DEFAULT now(),
  observacao text
);

CREATE INDEX idx_leituras_inv_pos ON public.leituras (inventario_id, codigo_posicao);
CREATE INDEX idx_leituras_inventario ON public.leituras (inventario_id);

ALTER TABLE public.leituras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leituras leitura publica" ON public.leituras
  FOR SELECT USING (true);

CREATE POLICY "Leituras insert se inventario aberto" ON public.leituras
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inventarios i
      WHERE i.id = inventario_id AND i.status = 'aberto'
    )
  );

CREATE POLICY "Leituras update admin" ON public.leituras
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Leituras delete publica" ON public.leituras
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.inventarios i
      WHERE i.id = inventario_id AND i.status = 'aberto'
    )
  );

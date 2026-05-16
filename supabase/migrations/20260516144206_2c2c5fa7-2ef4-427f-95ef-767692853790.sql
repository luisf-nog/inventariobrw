
UPDATE auth.users SET email_confirmed_at = now()
WHERE email = 'luis.benedito@brwsuprimentos.com.br' AND email_confirmed_at IS NULL;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'luis.benedito@brwsuprimentos.com.br'
ON CONFLICT (user_id, role) DO NOTHING;

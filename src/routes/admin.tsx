import { createFileRoute, useNavigate, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, LogOut } from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ email: string | null } | null>(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modo, setModo] = useState<"login" | "signup">("login");
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ? { email: session.user.email ?? null } : null);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ? { email: data.session.user.email ?? null } : null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    if (modo === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) toast.error(error.message);
      else toast.success("Login efetuado");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email, password: senha,
        options: { emailRedirectTo: `${window.location.origin}/admin` },
      });
      if (error) toast.error(error.message);
      else if (data.user) {
        // Tenta criar role admin (vai falhar se já houver políticas restritivas, mas no primeiro usuário funciona via service via SQL manual)
        try { await supabase.from("user_roles").insert({ user_id: data.user.id, role: "admin" }); } catch {}
        toast.success("Conta criada — você pode entrar");
      }
    }
    setSubmitting(false);
  }

  async function sair() {
    await supabase.auth.signOut();
    navigate({ to: "/admin" });
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando...</div>;

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <form onSubmit={entrar} className="w-full max-w-sm bg-card rounded-xl border border-border p-6 space-y-4">
          <div>
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Voltar
            </Link>
            <h1 className="text-2xl font-bold mt-2">Supervisor</h1>
            <p className="text-sm text-muted-foreground">{modo === "login" ? "Acesso administrativo" : "Criar conta de supervisor"}</p>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Senha</Label>
            <Input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <Button type="submit" disabled={submitting} className="w-full h-12">
            {submitting ? "..." : modo === "login" ? "Entrar" : "Criar conta"}
          </Button>
          <button type="button" onClick={() => setModo(modo === "login" ? "signup" : "login")} className="w-full text-xs text-muted-foreground hover:text-foreground">
            {modo === "login" ? "Primeira vez? Criar conta" : "Já tem conta? Entrar"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      <header className="mb-6 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Supervisor</p>
          <h1 className="text-xl font-bold">{user.email}</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={sair}><LogOut className="h-4 w-4 mr-1" /> Sair</Button>
      </header>

      <nav className="flex gap-2 mb-6 border-b border-border">
        <Link to="/admin" className="px-4 py-2 text-sm hover:text-primary [&.active]:text-primary [&.active]:border-b-2 [&.active]:border-primary" activeOptions={{ exact: true }}>Inventários</Link>
        <Link to="/admin/operadores" className="px-4 py-2 text-sm hover:text-primary [&.active]:text-primary [&.active]:border-b-2 [&.active]:border-primary">Operadores</Link>
        <Link to="/admin/produtos" className="px-4 py-2 text-sm hover:text-primary [&.active]:text-primary [&.active]:border-b-2 [&.active]:border-primary">Produtos</Link>
      </nav>

      <Outlet />
    </div>
  );
}

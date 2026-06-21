import { createFileRoute, useNavigate, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ email: string | null } | null>(null);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) toast.error(error.message);
    else toast.success("Login efetuado");
    setSubmitting(false);
  }

  async function sair() {
    await supabase.auth.signOut();
    navigate({ to: "/admin" });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
              <ShieldCheck className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Supervisor</h1>
            <p className="text-sm text-muted-foreground mt-1">Acesso administrativo</p>
          </div>

          <form onSubmit={entrar} className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Email</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Senha</Label>
              <Input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} className="h-11" />
            </div>
            <Button type="submit" disabled={submitting} className="w-full h-12 text-base font-semibold">
              {submitting
                ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : "Entrar"}
            </Button>
          </form>

          <div className="text-center">
            <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao início
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-none mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Supervisor</p>
            <p className="text-sm font-semibold truncate leading-tight">{user.email}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={sair} className="gap-1.5 text-muted-foreground hover:text-foreground shrink-0">
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
        <nav className="max-w-none mx-auto px-4 flex gap-1 border-t border-border/50">
          {[
            { to: "/admin" as const, label: "Inventários", exact: true },
            { to: "/admin/conferencias" as const, label: "Conferências", exact: false },
            { to: "/admin/operadores" as const, label: "Operadores", exact: false },
            { to: "/admin/produtos" as const, label: "Produtos", exact: false },
          ].map(({ to, label, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact }}
              className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors [&.active]:text-primary [&.active]:border-b-2 [&.active]:border-primary"
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="max-w-none mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

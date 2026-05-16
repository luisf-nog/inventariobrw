import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOperador, clearOperador } from "@/lib/operador-session";
import { Button } from "@/components/ui/button";
import { Package, LogOut } from "lucide-react";

export const Route = createFileRoute("/inventarios")({
  component: ListaInventarios,
});

type Inv = { id: string; nome: string; descricao: string | null; criado_em: string; leituras: number };

function ListaInventarios() {
  const navigate = useNavigate();
  const [op, setOp] = useState<{ id: string; nome: string } | null>(null);
  const [invs, setInvs] = useState<Inv[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const o = getOperador();
    if (!o) { navigate({ to: "/" }); return; }
    setOp(o);

    (async () => {
      const { data, error } = await supabase
        .from("inventarios")
        .select("id, nome, descricao, criado_em")
        .eq("status", "aberto")
        .order("criado_em", { ascending: false });
      if (error) { console.error(error); setLoading(false); return; }
      const ids = (data ?? []).map((d) => d.id);
      const counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: leituras } = await supabase
          .from("leituras")
          .select("inventario_id")
          .in("inventario_id", ids);
        for (const l of leituras ?? []) {
          counts[l.inventario_id] = (counts[l.inventario_id] ?? 0) + 1;
        }
      }
      setInvs((data ?? []).map((d) => ({ ...d, leituras: counts[d.id] ?? 0 })));
      setLoading(false);
    })();
  }, [navigate]);

  function sair() {
    clearOperador();
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Operador</p>
          <h1 className="text-2xl font-bold">{op?.nome}</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={sair}><LogOut className="h-4 w-4 mr-1" /> Trocar</Button>
      </header>

      <h2 className="text-xl font-semibold mb-4">Inventários abertos</h2>

      {loading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : invs.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground">Nenhum inventário aberto no momento.</p>
          <Link to="/admin" className="mt-3 inline-block text-primary underline text-sm">Supervisor: criar inventário</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {invs.map((inv) => (
            <Link
              key={inv.id}
              to="/inventario/$id/contagem"
              params={{ id: inv.id }}
              className="bg-card hover:bg-secondary p-5 rounded-xl border border-border transition active:scale-[0.98]"
            >
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 text-primary p-2 rounded-lg">
                  <Package className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{inv.nome}</p>
                  {inv.descricao && <p className="text-sm text-muted-foreground truncate">{inv.descricao}</p>}
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span>{new Date(inv.criado_em).toLocaleDateString("pt-BR")}</span>
                    <span>{inv.leituras} leituras</span>
                  </div>
                </div>
              </div>
              <Button className="w-full mt-4 h-12 text-base" size="lg">Continuar contagem</Button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

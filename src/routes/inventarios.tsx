import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOperador, clearOperador } from "@/lib/operador-session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Package2, PackageOpen, ChevronRight } from "lucide-react";

type RankEntry = { id: string; nome: string; count: number };

export const Route = createFileRoute("/inventarios")({
  component: ListaInventarios,
});

type Inv = { id: string; nome: string; descricao: string | null; criado_em: string; leituras: number; ranking: RankEntry[] };

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
      const rankMap: Record<string, Map<string, RankEntry>> = {};
      if (ids.length > 0) {
        const { data: leituras } = await supabase
          .from("leituras")
          .select("inventario_id, operador_id, operadores(nome)")
          .in("inventario_id", ids);
        for (const l of (leituras ?? []) as any[]) {
          counts[l.inventario_id] = (counts[l.inventario_id] ?? 0) + 1;
          const opId = l.operador_id as string | null;
          if (!opId) continue;
          if (!rankMap[l.inventario_id]) rankMap[l.inventario_id] = new Map();
          const ex = rankMap[l.inventario_id].get(opId) ?? { id: opId, nome: l.operadores?.nome ?? "?", count: 0 };
          ex.count++;
          rankMap[l.inventario_id].set(opId, ex);
        }
      }
      setInvs((data ?? []).map((d) => ({
        ...d,
        leituras: counts[d.id] ?? 0,
        ranking: Array.from(rankMap[d.id]?.values() ?? []).sort((a, b) => b.count - a.count),
      })));
      setLoading(false);
    })();
  }, [navigate]);

  function sair() { clearOperador(); navigate({ to: "/" }); }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Operador</p>
            <p className="text-sm font-semibold truncate leading-tight">{op?.nome}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={sair} className="gap-1.5 text-muted-foreground hover:text-foreground shrink-0">
            <LogOut className="h-4 w-4" /> Trocar
          </Button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide mb-4">Inventários disponíveis</h2>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <PackageOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum inventário aberto no momento.</p>
            <Link to="/admin" className="mt-3 inline-block text-primary underline text-sm">
              Supervisor: criar inventário
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {invs.map((inv) => (
              <Link
                key={inv.id}
                to="/inventario/$id/contagem"
                params={{ id: inv.id }}
                className="block bg-card border border-border rounded-xl p-4 hover:border-primary/40 active:scale-[0.99] transition-all"
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className="bg-primary/10 text-primary p-2.5 rounded-xl shrink-0">
                    <Package2 className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate leading-tight">{inv.nome}</p>
                    {inv.descricao && <p className="text-xs text-muted-foreground truncate mt-0.5">{inv.descricao}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(inv.criado_em).toLocaleDateString("pt-BR")}
                      </span>
                      {inv.leituras > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {inv.leituras} leituras
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg py-3 font-semibold text-sm">
                  Iniciar contagem <ChevronRight className="h-4 w-4" />
                </div>

                {inv.ranking.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Ranking</p>
                    {inv.ranking.slice(0, 3).map((r, i) => {
                      const medals = ["🥇", "🥈", "🥉"];
                      const isMe = r.id === op?.id;
                      return (
                        <div key={r.id} className={`flex items-center gap-2 text-xs ${isMe ? "font-bold text-primary" : "text-muted-foreground"}`}>
                          <span className="w-5 shrink-0 text-center text-sm">{medals[i]}</span>
                          <span className="flex-1 truncate">{r.nome}{isMe ? " (você)" : ""}</span>
                          <span className="tabular-nums font-semibold text-foreground/60">{r.count}</span>
                        </div>
                      );
                    })}
                    {(() => {
                      const myIdx = inv.ranking.findIndex((r) => r.id === op?.id);
                      if (myIdx >= 3) {
                        const me = inv.ranking[myIdx];
                        return (
                          <div className="pt-1 mt-0.5 border-t border-border/30 flex items-center gap-2 text-xs text-primary">
                            <span className="w-5 shrink-0 text-center font-bold text-sm">{myIdx + 1}°</span>
                            <span className="flex-1 truncate font-semibold">{me.nome} (você)</span>
                            <span className="tabular-nums font-bold">{me.count}</span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

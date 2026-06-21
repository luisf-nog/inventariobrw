import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getOperador, clearOperador } from "@/lib/operador-session";
import { Button } from "@/components/ui/button";
import { LogOut, PackageOpen, ScanLine, ChevronRight, Settings, PackageSearch, MapPinned } from "lucide-react";

export const Route = createFileRoute("/hub")({
  component: Hub,
});

type Tool = {
  to: "/inventarios" | "/conferencia" | "/busca-produto" | "/vazias-rua";
  titulo: string;
  descricao: string;
  Icon: typeof PackageOpen;
  cor: string;
};

const tools: Tool[] = [
  {
    to: "/inventarios",
    titulo: "Inventários",
    descricao: "Contagem por posição dos inventários abertos",
    Icon: PackageOpen,
    cor: "rgba(34, 195, 154, 0.18)",
  },
  {
    to: "/conferencia",
    titulo: "Conferência de Posição",
    descricao: "Bipe uma posição e veja, em tempo real, o que o WMS aponta",
    Icon: ScanLine,
    cor: "rgba(255, 184, 0, 0.18)",
  },
  {
    to: "/busca-produto",
    titulo: "Busca por Produto",
    descricao: "Bipe o SKU ou EAN e veja todas as posições do produto",
    Icon: PackageSearch,
    cor: "rgba(99, 102, 241, 0.18)",
  },
  {
    to: "/vazias-rua",
    titulo: "Mapa de Vazias por Rua",
    descricao: "Bipe uma posição e valide no físico as vagas que o WMS aponta como vazias",
    Icon: MapPinned,
    cor: "rgba(244, 114, 182, 0.18)",
  },
];

function Hub() {
  const navigate = useNavigate();
  const [op, setOp] = useState<{ id: string; nome: string } | null>(null);

  useEffect(() => {
    const o = getOperador();
    if (!o) { navigate({ to: "/" }); return; }
    setOp(o);
  }, [navigate]);

  function sair() { clearOperador(); navigate({ to: "/" }); }

  return (
    <div className="min-h-screen bg-background text-foreground">
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
        <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Ferramentas de inventário
        </h2>

        <div className="space-y-3">
          {tools.map(({ to, titulo, descricao, Icon, cor }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-4 bg-card border border-border rounded-xl p-4 hover:border-primary/40 active:scale-[0.99] transition-all"
            >
              <div
                className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: cor }}
              >
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">{titulo}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{descricao}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link to="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="h-3.5 w-3.5" /> Painel do supervisor
          </Link>
        </div>
      </main>
    </div>
  );
}

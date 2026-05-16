import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setOperador } from "@/lib/operador-session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { User, Settings } from "lucide-react";

export const Route = createFileRoute("/")({
  component: SelecaoOperador,
});

type Operador = { id: string; nome: string; pin: string | null };

function SelecaoOperador() {
  const navigate = useNavigate();
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionado, setSelecionado] = useState<Operador | null>(null);
  const [pin, setPin] = useState("");

  useEffect(() => {
    supabase.from("operadores").select("id, nome, pin").eq("ativo", true).order("nome").then(({ data, error }) => {
      if (error) toast.error("Erro ao carregar operadores: " + error.message);
      setOperadores(data ?? []);
      setLoading(false);
    });
  }, []);

  function escolher(op: Operador) {
    if (op.pin) {
      setSelecionado(op);
      setPin("");
    } else {
      confirmar(op);
    }
  }

  function confirmar(op: Operador, pinInformado?: string) {
    if (op.pin && op.pin !== pinInformado) {
      toast.error("PIN incorreto");
      return;
    }
    setOperador({ id: op.id, nome: op.nome });
    navigate({ to: "/inventarios" });
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Inventário</h1>
          <p className="text-muted-foreground">Selecione seu nome para começar</p>
        </div>
        <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
          <Settings className="h-4 w-4" /> Supervisor
        </Link>
      </header>

      {loading ? (
        <p className="text-center text-muted-foreground">Carregando...</p>
      ) : operadores.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground">Nenhum operador cadastrado.</p>
          <Link to="/admin" className="mt-3 inline-block text-primary underline">Acessar painel do supervisor</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {operadores.map((op) => (
            <button
              key={op.id}
              onClick={() => escolher(op)}
              className="bg-card hover:bg-secondary text-card-foreground p-6 rounded-xl border border-border text-left transition active:scale-[0.98]"
            >
              <div className="flex items-center gap-4">
                <div className="bg-primary/10 text-primary p-3 rounded-full">
                  <User className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-lg font-semibold">{op.nome}</p>
                  {op.pin && <p className="text-xs text-muted-foreground">PIN protegido</p>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selecionado} onOpenChange={(o) => !o && setSelecionado(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PIN de {selecionado?.nome}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter" && selecionado) confirmar(selecionado, pin); }}
            className="text-center text-3xl h-16 tracking-[0.5em]"
          />
          <Button size="lg" className="h-14 text-lg" onClick={() => selecionado && confirmar(selecionado, pin)}>
            Continuar
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

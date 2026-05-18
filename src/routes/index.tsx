import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setOperador } from "@/lib/operador-session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Settings, Package } from "lucide-react";

export const Route = createFileRoute("/")({
  component: SelecaoOperador,
});

type Operador = { id: string; nome: string; tem_pin: boolean };

function initials(nome: string) {
  return nome.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function SelecaoOperador() {
  const navigate = useNavigate();
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecionado, setSelecionado] = useState<Operador | null>(null);
  const [pin, setPin] = useState("");
  const [validando, setValidando] = useState(false);

  useEffect(() => {
    supabase.from("operadores").select("id, nome, tem_pin").eq("ativo", true).order("nome").then(({ data, error }) => {
      if (error) toast.error("Erro ao carregar operadores: " + error.message);
      setOperadores((data ?? []) as Operador[]);
      setLoading(false);
    });
  }, []);

  function escolher(op: Operador) {
    if (op.tem_pin) { setSelecionado(op); setPin(""); }
    else void confirmar(op);
  }

  async function confirmar(op: Operador, pinInformado?: string) {
    if (op.tem_pin && pinInformado !== undefined) {
      setValidando(true);
      const { data: valido, error } = await supabase.rpc("verificar_pin_operador", {
        p_operador_id: op.id,
        p_pin: pinInformado,
      });
      setValidando(false);
      if (error || !valido) { toast.error("PIN incorreto"); return; }
    }
    setOperador({ id: op.id, nome: op.nome });
    navigate({ to: "/inventarios" });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Branding */}
      <div className="pt-14 pb-8 px-6 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-5">
          <Package className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Inventário</h1>
        <p className="text-sm text-muted-foreground mt-1">Selecione seu nome para começar</p>
      </div>

      {/* Operador grid */}
      <div className="flex-1 px-4 pb-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : operadores.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center max-w-sm mx-auto">
            <p className="text-muted-foreground text-sm">Nenhum operador cadastrado.</p>
            <Link to="/admin" className="mt-3 inline-block text-primary text-sm underline">
              Acessar painel do supervisor
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
            {operadores.map((op) => (
              <button
                key={op.id}
                onClick={() => escolher(op)}
                className="flex flex-col items-center gap-3 bg-card hover:bg-secondary active:scale-[0.97] border border-border rounded-xl p-5 transition-all"
              >
                <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xl">
                  {initials(op.nome)}
                </div>
                <div className="text-center min-w-0 w-full">
                  <p className="text-sm font-semibold truncate">{op.nome}</p>
                  {op.tem_pin && <p className="text-[10px] text-muted-foreground mt-0.5">PIN ●●●●</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pb-10 text-center">
        <Link to="/admin" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <Settings className="h-3.5 w-3.5" /> Supervisor
        </Link>
      </div>

      {/* PIN Dialog */}
      <Dialog open={!!selecionado} onOpenChange={(o) => !o && setSelecionado(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center text-base">PIN de {selecionado?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <Input
              autoFocus
              inputMode="numeric"
              maxLength={4}
              placeholder="• • • •"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && selecionado) void confirmar(selecionado, pin); }}
              className="text-center text-4xl h-16 tracking-[0.6em] font-mono border-border/60"
            />
            <Button
              size="lg"
              className="w-full h-12 text-base font-semibold"
              disabled={validando || pin.length < 4}
              onClick={() => selecionado && void confirmar(selecionado, pin)}
            >
              {validando
                ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : "Entrar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useState } from "react";
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

const homeStyle: CSSProperties = { minHeight: "100vh", background: "#11141c", color: "#f1f3f7" };
const brandingStyle: CSSProperties = { padding: "42px 16px 24px", textAlign: "center" };
const logoStyle: CSSProperties = {
  width: 56,
  height: 56,
  lineHeight: "56px",
  margin: "0 auto 16px",
  borderRadius: 16,
  background: "rgba(34, 195, 154, 0.18)",
  border: "1px solid rgba(34, 195, 154, 0.42)",
  color: "#22c39a",
  textAlign: "center",
};
const titleStyle: CSSProperties = { margin: 0, fontSize: 26, lineHeight: 1.15, fontWeight: 800, color: "#f1f3f7" };
const subtitleStyle: CSSProperties = { margin: "8px 0 0", fontSize: 14, lineHeight: 1.35, fontWeight: 700, color: "#f1f3f7" };
const contentStyle: CSSProperties = { padding: "0 10px 18px" };
const gridStyle: CSSProperties = { maxWidth: 384, margin: "0 auto", textAlign: "center", display: "block" };
const cardStyle: CSSProperties = {
  display: "inline-block",
  verticalAlign: "top",
  boxSizing: "border-box",
  width: "44%",
  minHeight: 132,
  margin: "6px 3%",
  padding: "18px 8px 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.14)",
  color: "#f1f3f7",
  textAlign: "center",
};
const initialsStyle: CSSProperties = {
  width: 52,
  height: 52,
  lineHeight: "52px",
  margin: "0 auto 12px",
  borderRadius: 999,
  background: "rgba(34, 195, 154, 0.24)",
  border: "1px solid rgba(34, 195, 154, 0.45)",
  color: "#22e6b3",
  textAlign: "center",
  fontSize: 20,
  fontWeight: 800,
};
const nameStyle: CSSProperties = { margin: 0, color: "#fff1bb", fontSize: 13, lineHeight: 1.2, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const pinStyle: CSSProperties = { margin: "6px 0 0", color: "#f1f3f7", fontSize: 11, lineHeight: 1.2, fontWeight: 800 };
const footerStyle: CSSProperties = { padding: "0 16px 34px", textAlign: "center" };
const adminLinkStyle: CSSProperties = { color: "#22c39a", fontSize: 13, fontWeight: 800, textDecoration: "underline" };
const pinInputStyle: CSSProperties = { height: 64, textAlign: "center", fontSize: 34, letterSpacing: "0.35em", background: "#111827", color: "#f1f3f7", border: "1px solid #4b5875" };
const confirmButtonStyle: CSSProperties = { width: "100%", height: 48, marginTop: 16, borderRadius: 8, background: "#22c39a", color: "#11141c", fontSize: 16, fontWeight: 800 };

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
    <main className="collector-home min-h-screen flex flex-col bg-background" style={homeStyle}>
      {/* Branding */}
      <div className="collector-branding pt-14 pb-8 px-6 text-center" style={brandingStyle}>
        <div className="collector-logo inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-5" style={logoStyle}>
          <Package className="h-8 w-8 text-primary" style={{ width: 32, height: 32, marginTop: 12 }} />
        </div>
        <h1 className="collector-title text-2xl font-bold tracking-tight" style={titleStyle}>Inventário</h1>
        <p className="collector-subtitle text-sm text-muted-foreground mt-1" style={subtitleStyle}>Selecione seu nome para começar</p>
      </div>

      {/* Operador grid */}
      <div className="collector-content flex-1 px-4 pb-6" style={contentStyle}>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="collector-loader w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : operadores.length === 0 ? (
          <div className="collector-empty rounded-xl border border-dashed border-border p-10 text-center max-w-sm mx-auto">
            <p className="text-muted-foreground text-sm">Nenhum operador cadastrado.</p>
            <Link to="/admin" className="mt-3 inline-block text-primary text-sm underline">
              Acessar painel do supervisor
            </Link>
          </div>
        ) : (
          <div className="collector-grid max-w-sm mx-auto" style={gridStyle}>
            {operadores.map((op) => (
              <button
                key={op.id}
                onClick={() => escolher(op)}
                className="collector-operator-card flex flex-col items-center gap-3 bg-card hover:bg-secondary active:scale-[0.97] border border-border rounded-xl p-5 transition-all"
                style={cardStyle}
              >
                <div className="collector-initials w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-xl" style={initialsStyle}>
                  {initials(op.nome)}
                </div>
                <div className="text-center min-w-0 w-full">
                  <p className="collector-operator-name text-sm font-semibold truncate" style={nameStyle}>{op.nome}</p>
                  {op.tem_pin && <p className="collector-pin text-[10px] text-muted-foreground mt-0.5" style={pinStyle}>PIN ●●●●</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="collector-footer pb-10 text-center" style={footerStyle}>
        <Link to="/admin" className="collector-admin-link inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors" style={adminLinkStyle}>
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
              style={pinInputStyle}
            />
            <Button
              size="lg"
              className="w-full h-12 text-base font-semibold"
              style={confirmButtonStyle}
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
    </main>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Users } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/operadores")({
  component: AdminOperadores,
});

type Op = { id: string; nome: string; pin: string | null; ativo: boolean };

function AdminOperadores() {
  const [ops, setOps] = useState<Op[]>([]);
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [pin, setPin] = useState("");

  async function carregar() {
    const { data } = await supabase.from("operadores").select("*").order("nome");
    setOps(data ?? []);
  }
  useEffect(() => { carregar(); }, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    const { error } = await supabase.from("operadores").insert({ nome: nome.trim(), pin: pin.trim() || null });
    if (error) { toast.error(error.message); return; }
    toast.success("Operador criado");
    setNome(""); setPin(""); setOpen(false);
    carregar();
  }

  async function toggleAtivo(op: Op) {
    const { error } = await supabase.from("operadores").update({ ativo: !op.ativo }).eq("id", op.id);
    if (error) { toast.error(error.message); return; }
    carregar();
  }

  async function remover(op: Op) {
    if (!confirm(`Remover ${op.nome}?`)) return;
    const { error } = await supabase.from("operadores").delete().eq("id", op.id);
    if (error) { toast.error(error.message); return; }
    carregar();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Operadores</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Adicionar</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Novo operador</DialogTitle>
            </DialogHeader>
            <form onSubmit={criar} className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Nome</Label>
                <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="João Silva" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">PIN (opcional, 4 dígitos)</Label>
                <Input
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  className="tracking-widest text-center font-mono text-lg h-11"
                />
              </div>
              <Button type="submit" className="w-full h-11 font-semibold">Criar operador</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {ops.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum operador cadastrado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ops.map((op) => (
            <div key={op.id} className={`bg-card border rounded-xl p-4 flex items-center justify-between gap-3 ${op.ativo ? "border-border" : "border-border/40 opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{op.nome}</p>
                  {op.pin && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">PIN</Badge>}
                  {!op.ativo && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Inativo</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{op.pin ? "PIN configurado" : "Sem PIN"}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Switch checked={op.ativo} onCheckedChange={() => toggleAtivo(op)} />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => remover(op)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

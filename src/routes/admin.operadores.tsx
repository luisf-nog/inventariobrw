import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
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
    const { error } = await supabase.from("operadores").insert({
      nome: nome.trim(),
      pin: pin.trim() || null,
    });
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
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Operadores</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo operador</DialogTitle></DialogHeader>
            <form onSubmit={criar} className="space-y-3">
              <div><Label>Nome</Label><Input required value={nome} onChange={(e) => setNome(e.target.value)} /></div>
              <div>
                <Label>PIN (opcional, 4 dígitos)</Label>
                <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0,4))} inputMode="numeric" />
              </div>
              <Button type="submit" className="w-full">Criar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {ops.length === 0 && <p className="text-muted-foreground text-sm">Nenhum operador.</p>}
        {ops.map((op) => (
          <div key={op.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{op.nome}</p>
              <p className="text-xs text-muted-foreground">{op.pin ? "PIN configurado" : "Sem PIN"}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={op.ativo} onCheckedChange={() => toggleAtivo(op)} />
                <span className="text-xs text-muted-foreground">{op.ativo ? "Ativo" : "Inativo"}</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => remover(op)} className="text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

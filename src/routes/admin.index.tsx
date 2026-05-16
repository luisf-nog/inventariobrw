import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/")({
  component: AdminInventarios,
});

type Inv = { id: string; nome: string; descricao: string | null; status: string; criado_em: string };

function AdminInventarios() {
  const [invs, setInvs] = useState<Inv[]>([]);
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [saving, setSaving] = useState(false);

  async function carregar() {
    const { data } = await supabase.from("inventarios").select("*").order("criado_em", { ascending: false });
    setInvs(data ?? []);
  }
  useEffect(() => { carregar(); }, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("inventarios").insert({ nome: nome.trim(), descricao: descricao.trim() || null });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Inventário criado");
    setNome(""); setDescricao(""); setOpen(false);
    carregar();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Inventários</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Novo</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo inventário</DialogTitle></DialogHeader>
            <form onSubmit={criar} className="space-y-3">
              <div><Label>Nome</Label><Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Inventário Geral 11/2026" /></div>
              <div><Label>Descrição</Label><Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} /></div>
              <Button type="submit" disabled={saving} className="w-full">{saving ? "..." : "Criar"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {invs.length === 0 && <p className="text-muted-foreground text-sm">Nenhum inventário ainda.</p>}
        {invs.map((inv) => (
          <div key={inv.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold truncate">{inv.nome}</p>
                <Badge variant={inv.status === "aberto" ? "default" : "secondary"}>{inv.status}</Badge>
              </div>
              {inv.descricao && <p className="text-sm text-muted-foreground truncate">{inv.descricao}</p>}
              <p className="text-xs text-muted-foreground">{new Date(inv.criado_em).toLocaleString("pt-BR")}</p>
            </div>
            <Link to="/inventario/$id/resumo" params={{ id: inv.id }}>
              <Button variant="outline" size="sm"><FileText className="h-4 w-4 mr-1" /> Resumo</Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

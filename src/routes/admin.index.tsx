import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sincronizarEstoqueWms } from "@/lib/wms.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, FileText, PackageOpen } from "lucide-react";
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
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Inventários</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Novo</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Novo inventário</DialogTitle>
            </DialogHeader>
            <form onSubmit={criar} className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Nome</Label>
                <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Inventário Geral 11/2026" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Descrição (opcional)</Label>
                <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2} />
              </div>
              <Button type="submit" disabled={saving} className="w-full h-11 font-semibold">
                {saving
                  ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : "Criar inventário"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {invs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <PackageOpen className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum inventário ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {invs.map((inv) => (
            <div key={inv.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold truncate">{inv.nome}</p>
                  <Badge
                    variant={inv.status === "aberto" ? "default" : "secondary"}
                    className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                  >
                    {inv.status}
                  </Badge>
                </div>
                {inv.descricao && <p className="text-xs text-muted-foreground truncate mt-0.5">{inv.descricao}</p>}
                <p className="text-xs text-muted-foreground mt-1">{new Date(inv.criado_em).toLocaleString("pt-BR")}</p>
              </div>
              <Link to="/inventario/$id/resumo" params={{ id: inv.id }}>
                <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                  <FileText className="h-3.5 w-3.5" /> Resumo
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

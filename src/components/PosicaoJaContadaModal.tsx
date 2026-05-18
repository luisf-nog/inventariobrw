import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { formatPosicaoDisplay } from "@/lib/validation";

export type LeituraExistente = {
  codigo_produto: string;
  quantidade: number;
  numero_contagem: number;
  lido_em: string;
  operador_nome: string | null;
};

export type AcaoPosicao = "pular" | "nova_contagem" | "adicionar";

type Props = {
  open: boolean;
  posicao: string;
  contagemAtual: number;
  leituras: LeituraExistente[];
  onClose: () => void;
  onEscolher: (acao: AcaoPosicao) => void;
};

export function PosicaoJaContadaModal({ open, posicao, contagemAtual, leituras, onClose, onEscolher }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? leituras : leituras.slice(0, 3);
  const ultima = leituras[0];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            Posição já contada
          </DialogTitle>
          <DialogDescription className="text-foreground/70 pt-1">
            <span className="font-mono font-semibold text-foreground">{formatPosicaoDisplay(posicao)}</span>
            {" "}— contagem atual nº <strong>{contagemAtual}</strong>
          </DialogDescription>
        </DialogHeader>

        {/* Leituras */}
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{leituras.length} leitura(s) registradas</p>
          <div className="space-y-1.5">
            {visible.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs font-mono">
                <span className="truncate text-foreground/80">{l.codigo_produto}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-semibold">{l.quantidade}</span>
                  <span className="text-muted-foreground">c{l.numero_contagem}</span>
                </div>
              </div>
            ))}
          </div>
          {leituras.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] text-primary mt-1"
            >
              {expanded
                ? <><ChevronUp className="h-3 w-3" /> Recolher</>
                : <><ChevronDown className="h-3 w-3" /> Ver todas ({leituras.length})</>}
            </button>
          )}
          {ultima && (
            <p className="text-[10px] text-muted-foreground border-t border-border pt-2 mt-1">
              Última: {new Date(ultima.lido_em).toLocaleString("pt-BR")} · {ultima.operador_nome ?? "?"}
            </p>
          )}
        </div>

        {/* Ações */}
        <div className="grid gap-2">
          <Button size="lg" variant="secondary" className="h-12 justify-start gap-2 text-sm" onClick={() => onEscolher("nova_contagem")}>
            <span className="text-base">🔄</span> Iniciar {contagemAtual + 1}ª contagem
          </Button>
          <Button size="lg" variant="outline" className="h-12 justify-start gap-2 text-sm" onClick={() => onEscolher("adicionar")}>
            <span className="text-base">➕</span> Adicionar à {contagemAtual}ª contagem
          </Button>
          <Button size="lg" variant="ghost" className="h-10 justify-start gap-2 text-sm text-muted-foreground" onClick={() => onEscolher("pular")}>
            <span className="text-base">⏭</span> Pular esta posição
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

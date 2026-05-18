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
  operador_id: string | null;
};

export type AcaoPosicao = "pular" | "nova_contagem";

type Props = {
  open: boolean;
  posicao: string;
  contagemAtual: number;
  leituras: LeituraExistente[];
  operadorAtualId: string | null;
  onClose: () => void;
  onEscolher: (acao: AcaoPosicao) => void;
};

export function PosicaoJaContadaModal({ open, posicao, contagemAtual, leituras, operadorAtualId, onClose, onEscolher }: Props) {
  const jaContouEsteOperador = operadorAtualId != null && leituras.some((l) => l.operador_id === operadorAtualId);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? leituras : leituras.slice(0, 3);
  const ultima = leituras[0];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm bg-popover !opacity-100 shadow-2xl gap-3 p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base text-warning">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            Posição já contada
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{formatPosicaoDisplay(posicao)}</span>
            {" · "}contagem atual <strong className="text-foreground">nº {contagemAtual}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {leituras.length} leitura(s) registradas
          </p>
          <div className="space-y-1">
            {visible.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs font-mono py-0.5">
                <span className="truncate text-foreground/90">{l.codigo_produto}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold tabular-nums">{l.quantidade}</span>
                  <span className="text-muted-foreground text-[10px] px-1.5 py-0.5 rounded bg-muted/60">c{l.numero_contagem}</span>
                </div>
              </div>
            ))}
          </div>
          {leituras.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {expanded
                ? <><ChevronUp className="h-3 w-3" /> Recolher</>
                : <><ChevronDown className="h-3 w-3" /> Ver todas ({leituras.length})</>}
            </button>
          )}
          {ultima && (
            <p className="text-[10px] text-muted-foreground border-t border-border pt-2 mt-1 leading-tight">
              Última: {new Date(ultima.lido_em).toLocaleString("pt-BR")} · {ultima.operador_nome ?? "?"}
            </p>
          )}
        </div>

        {jaContouEsteOperador && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
            <p className="font-semibold mb-1">Nova contagem bloqueada</p>
            <p className="text-destructive/90">
              Você já contou esta posição. A {contagemAtual + 1}ª contagem precisa ser feita por
              <strong> outro operador</strong> para garantir auditoria independente.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <Button
            size="lg"
            variant="default"
            className="h-12 justify-start gap-3 text-sm font-semibold"
            disabled={jaContouEsteOperador}
            onClick={() => !jaContouEsteOperador && onEscolher("nova_contagem")}
          >
            <span className="text-base">🔄</span> Iniciar {contagemAtual + 1}ª contagem
          </Button>
          <Button size="lg" variant="ghost" className="h-10 justify-start gap-3 text-sm text-muted-foreground" onClick={() => onEscolher("pular")}>
            <span className="text-base">⏭</span> Pular esta posição
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

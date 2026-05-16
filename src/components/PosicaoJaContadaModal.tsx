import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

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

  const resumo = leituras.slice(0, 3);
  const ultima = leituras[0];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            Posição já contada
          </DialogTitle>
          <DialogDescription className="text-foreground/80">
            <span className="font-mono text-base">{posicao}</span> — contagem atual nº <strong>{contagemAtual}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-secondary/50 p-3 text-sm">
          <p className="text-muted-foreground mb-2">{leituras.length} leitura(s) registradas:</p>
          <div className="space-y-1.5 font-mono text-xs">
            {(expanded ? leituras : resumo).map((l, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="truncate">{l.codigo_produto}</span>
                <span>{l.quantidade} <span className="text-muted-foreground">(c{l.numero_contagem})</span></span>
              </div>
            ))}
          </div>
          {leituras.length > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 text-xs text-primary inline-flex items-center gap-1"
            >
              {expanded ? <><ChevronUp className="h-3 w-3" /> Recolher</> : <><ChevronDown className="h-3 w-3" /> Ver todas ({leituras.length})</>}
            </button>
          )}
          {ultima && (
            <p className="text-xs text-muted-foreground mt-2 border-t border-border pt-2">
              Última: {new Date(ultima.lido_em).toLocaleString("pt-BR")} — {ultima.operador_nome ?? "?"}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Button size="lg" variant="secondary" className="h-12 justify-start" onClick={() => onEscolher("pular")}>
            ⏭️ Pular esta posição
          </Button>
          <Button size="lg" className="h-12 justify-start bg-primary" onClick={() => onEscolher("nova_contagem")}>
            🔄 Iniciar {contagemAtual + 1}ª contagem
          </Button>
          <Button size="lg" variant="outline" className="h-12 justify-start" onClick={() => onEscolher("adicionar")}>
            ➕ Adicionar à contagem atual (nº {contagemAtual})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

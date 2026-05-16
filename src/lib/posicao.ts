// Tradução do código da posição para exibição amigável.
// Mantém o código original como chave (não usar este display para gravação).
//
// Regra para códigos de 12 dígitos (ex: `019950011305`):
//   dígitos 1-2   → depósito  (mantém)             "01"
//   dígitos 3-5   → rua       (mantém)             "995"
//   dígitos 6-8   → bloco     (remove UM zero à esquerda)  "001" → "01"
//   dígitos 9-12  → posição   (remove o penúltimo zero)    "1305" → "135"
// Resultado: "01.995.01.135"
//
// Para códigos fora desse padrão, devolve o próprio código.
export function formatPosicaoDisplay(codigo: string): string {
  const raw = (codigo ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return raw;

  const dep = digits.slice(0, 2);
  const rua = digits.slice(2, 5);
  const blocoRaw = digits.slice(5, 8);
  const posRaw = digits.slice(8, 12);

  const bloco = blocoRaw.replace(/^0/, ""); // remove só UM zero à esquerda
  // remove o penúltimo dígito se for "0"
  const pos =
    posRaw.length === 4 && posRaw[2] === "0"
      ? posRaw.slice(0, 2) + posRaw.slice(3)
      : posRaw;

  return `${dep}.${rua}.${bloco}.${pos}`;
}

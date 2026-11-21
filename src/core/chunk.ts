/**
 * Split a transcript into pieces small enough for the on-device model.
 * Gemini Nano in Chrome accepts ~9k tokens per prompt including the reply, so we keep each
 * chunk well under that (default 3,500 characters ≈ 900 tokens) and break on speaker turns.
 */
export function chunkTranscript(text: string, maxChars = 3500): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const line of lines) {
    if (line.length > maxChars) {
      push();
      for (const piece of splitLong(line, maxChars)) chunks.push(piece);
      continue;
    }
    if (cur.length + line.length + 1 > maxChars) push();
    cur += (cur ? "\n" : "") + line;
  }
  push();
  return chunks;
}

function splitLong(line: string, maxChars: number): string[] {
  const sentences = line.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [line];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > maxChars && cur) {
      out.push(cur.trim());
      cur = "";
    }
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars).trim());
      continue;
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

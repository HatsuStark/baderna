// Portão de ruído do microfone (sensibilidade). Roda no thread de áudio, então
// continua valendo com a janela minimizada (requestAnimationFrame para).
//
// - Detecta voz numa faixa filtrada (250–3500 Hz): ronco grave de ventilador e
//   parte do estalo agudo de teclado pesam pouco na decisão.
// - Pra abrir, o som tem que ficar acima do limiar por OPEN_AFTER (estalo curto
//   não abre). A saída sai atrasada LOOKAHEAD, então o começo da palavra passa.
// - Abaixo do limiar por HOLD, fecha devagar (sem estalo).
// - Automático: mede o ruído de fundo o tempo todo e usa ruído + ~6 dB. Som
//   bem acima do ruído é tratado como voz e não entra nessa conta.
//
// Mensagens: entra { mode: 'auto' } ou { mode: 'manual', threshold };
// sai { open, level, threshold } ~20 vezes por segundo (medidor e linha).

const LOOKAHEAD_S = 0.02;
const OPEN_AFTER_S = 0.02;
const HOLD_S = 0.3;
const ATTACK = 0.02;   // abre rápido
const RELEASE = 0.002; // fecha devagar
const AUTO_MARGIN = 2;                // ~ +6 dB acima do ruído de fundo
const AUTO_MIN = 10 ** (-58 / 20);    // limiar automático nunca abaixo disso...
const AUTO_MAX = 10 ** (-24 / 20);    // ...nem acima disso
const REPORT_S = 0.05;

// Biquad (RBJ) de 2ª ordem.
function biquad(type, freq, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const b = type === 'high'
    ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
    : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  const a0 = 1 + alpha;
  const f = { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  return (x) => {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    return y;
  };
}

class GateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.auto = true;
    this.manual = 0;
    this.floor = 10 ** (-50 / 20);
    this.open = false;
    this.above = 0; // amostras seguidas acima do limiar
    this.quiet = 0; // amostras seguidas abaixo, com o portão aberto
    this.gain = 0;
    // Passa-alta de 4ª ordem: ventilador/ar-condicionado (graves) quase somem.
    this.high = biquad('high', 250);
    this.high2 = biquad('high', 250);
    this.low = biquad('low', 3500);
    this.delay = Math.round(LOOKAHEAD_S * sampleRate);
    this.buffers = [];
    this.pos = 0;
    this.sinceReport = 0;
    this.level = 0;
    this.port.onmessage = (e) => {
      const d = e.data ?? {};
      this.auto = d.mode !== 'manual';
      const t = Number(d.threshold);
      this.manual = Number.isFinite(t) && t > 0 ? t : 0;
    };
  }

  threshold() {
    if (!this.auto) return this.manual;
    return Math.min(AUTO_MAX, Math.max(AUTO_MIN, this.floor * AUTO_MARGIN));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    const first = input[0];
    const n = first.length;

    // Detector: energia da faixa de voz neste bloco.
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = this.low(this.high2(this.high(first[i])));
      sum += v * v;
    }
    const rms = Math.sqrt(sum / n);
    this.level = rms;

    // Ruído de fundo: segue rápido pra baixo e devagar pra cima. Som bem acima
    // dele (provável voz) ou portão aberto quase não mexe; assim a própria fala
    // não empurra a linha pra cima, mas um ruído novo e constante é aprendido
    // em alguns segundos.
    const rate = rms < this.floor ? 0.05 : this.open || rms > this.floor * 2 ? 0.0003 : 0.004;
    this.floor += (rms - this.floor) * rate;

    const threshold = this.threshold();
    const loud = threshold > 0 && rms >= threshold;
    this.above = loud ? this.above + n : 0;
    if (!this.open && this.above >= OPEN_AFTER_S * sampleRate) {
      this.open = true;
      this.quiet = 0;
    } else if (this.open) {
      this.quiet = loud ? 0 : this.quiet + n;
      if (this.quiet >= HOLD_S * sampleRate) this.open = false;
    }

    // Saída atrasada (lookahead) com ganho suave.
    while (this.buffers.length < output.length) this.buffers.push(new Float32Array(this.delay));
    const target = this.open ? 1 : 0;
    const step = target > this.gain ? ATTACK : RELEASE;
    for (let i = 0; i < n; i++) {
      this.gain += (target - this.gain) * step;
      for (let c = 0; c < output.length; c++) {
        const buf = this.buffers[c];
        const delayed = buf[this.pos];
        buf[this.pos] = (input[c] ?? first)[i];
        output[c][i] = delayed * this.gain;
      }
      this.pos = (this.pos + 1) % this.delay;
    }

    this.sinceReport += n;
    if (this.sinceReport >= REPORT_S * sampleRate) {
      this.sinceReport = 0;
      this.port.postMessage({ open: this.open, level: this.level, threshold });
    }
    return true;
  }
}

registerProcessor('mic-gate', GateProcessor);

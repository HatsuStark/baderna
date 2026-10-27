// Portão de ruído do microfone (sensibilidade). Roda no thread de áudio, então
// continua valendo com a janela minimizada (requestAnimationFrame para).
// Abaixo do limiar por mais que HOLD, o som é cortado; acima, abre na hora.
// threshold 0 = automático (sempre aberto, só a supressão de ruído do Chrome).

const HOLD_SECONDS = 0.35;
const ATTACK = 0.02;   // abre rápido pra não comer o começo da palavra
const RELEASE = 0.002; // fecha devagar, sem estalo

class GateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.threshold = 0;
    this.quiet = Infinity; // amostras seguidas abaixo do limiar
    this.gain = 1;
    this.open = true;
    this.port.onmessage = (e) => {
      const t = Number(e.data?.threshold);
      this.threshold = Number.isFinite(t) && t > 0 ? t : 0;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    const first = input[0];
    let sum = 0;
    for (let i = 0; i < first.length; i++) sum += first[i] * first[i];
    const rms = Math.sqrt(sum / first.length);

    if (!this.threshold || rms >= this.threshold) this.quiet = 0;
    else this.quiet += first.length;
    const open = this.quiet < HOLD_SECONDS * sampleRate;
    if (open !== this.open) {
      this.open = open;
      this.port.postMessage({ open });
    }

    const target = open ? 1 : 0;
    const step = target > this.gain ? ATTACK : RELEASE;
    for (let i = 0; i < first.length; i++) {
      this.gain += (target - this.gain) * step;
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ?? first)[i] * this.gain;
    }
    return true;
  }
}

registerProcessor('mic-gate', GateProcessor);

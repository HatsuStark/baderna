// Toca PCM 16-bit estéreo intercalado vindo do proc-audio.exe.
// Buffer circular com latência baixa: o relógio da placa e o do AudioContext
// nunca batem exatos, então se acumular demais descarta até voltar ao alvo.

const RATE = 48000;
const CHANNELS = 2;
const CAPACITY = RATE * CHANNELS * 2;         // 2 s
const PREBUFFER = RATE * CHANNELS * 0.04;     // começa a tocar com 40 ms
const MAX_LATENCY = RATE * CHANNELS * 0.2;    // acima de 200 ms...
const TARGET_LATENCY = RATE * CHANNELS * 0.06; // ...volta pra 60 ms

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CAPACITY);
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.playing = false;
    this.port.onmessage = (e) => this.push(e.data);
  }

  push(pcm) {
    for (let i = 0; i < pcm.length; i++) {
      this.buf[this.write] = pcm[i] / 32768;
      this.write = (this.write + 1) % CAPACITY;
    }
    this.size += pcm.length;
    if (this.size > MAX_LATENCY) {
      const drop = (this.size - TARGET_LATENCY) & ~1; // mantém L/R alinhados
      this.read = (this.read + drop) % CAPACITY;
      this.size -= drop;
    }
  }

  process(_inputs, outputs) {
    const [left, right = left] = outputs[0];
    if (!this.playing) {
      if (this.size < PREBUFFER) return true;
      this.playing = true;
    }
    for (let i = 0; i < left.length; i++) {
      if (this.size < CHANNELS) {
        // Acabou o buffer (nada tocando na fonte): silêncio e volta a pré-carregar.
        left[i] = right[i] = 0;
        this.playing = false;
        continue;
      }
      left[i] = this.buf[this.read];
      right[i] = this.buf[(this.read + 1) % CAPACITY];
      this.read = (this.read + CHANNELS) % CAPACITY;
      this.size -= CHANNELS;
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);

// Toca PCM 16-bit estéreo intercalado vindo do proc-audio.exe.
// Buffer circular: o relógio da placa e o do AudioContext nunca batem exatos,
// então se acumular demais descarta até voltar ao alvo. Folga em segundos via
// processorOptions: a tela usa pouca (som casado com o vídeo); a rádio, mais
// (não tem vídeo, e engasgo de IPC ou de thread não pode virar buraco no som).
// A cada segundo manda { under, drops } pro app: quantas vezes o buffer secou
// e quantas vezes teve que descartar.

const RATE = 48000;
const CHANNELS = 2;
const CAPACITY = RATE * CHANNELS * 2; // 2 s
const STATS_EVERY = RATE;             // quadros (1 s)

class PcmPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions ?? {};
    const samples = (sec, def) => Math.round(RATE * CHANNELS * (Number(sec) > 0 ? Number(sec) : def)) & ~1;
    this.prebuffer = samples(o.prebuffer, 0.04);  // começa a tocar com isso
    this.maxLatency = samples(o.max, 0.2);        // acima disso...
    this.target = samples(o.target, 0.06);        // ...volta pra cá
    this.buf = new Float32Array(CAPACITY);
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.playing = false;
    this.under = 0;
    this.drops = 0;
    this.frames = 0;
    this.port.onmessage = (e) => this.push(e.data);
  }

  push(pcm) {
    for (let i = 0; i < pcm.length; i++) {
      this.buf[this.write] = pcm[i] / 32768;
      this.write = (this.write + 1) % CAPACITY;
    }
    this.size += pcm.length;
    if (this.size > this.maxLatency) {
      const drop = (this.size - this.target) & ~1; // mantém L/R alinhados
      this.read = (this.read + drop) % CAPACITY;
      this.size -= drop;
      this.drops++;
    }
  }

  process(_inputs, outputs) {
    const [left, right = left] = outputs[0];
    this.frames += left.length;
    if (this.frames >= STATS_EVERY) {
      this.frames = 0;
      if (this.under || this.drops) this.port.postMessage({ under: this.under, drops: this.drops });
      this.under = 0;
      this.drops = 0;
    }
    if (!this.playing) {
      if (this.size < this.prebuffer) return true;
      this.playing = true;
    }
    for (let i = 0; i < left.length; i++) {
      if (this.size < CHANNELS) {
        // Acabou o buffer: silêncio e volta a pré-carregar.
        left[i] = right[i] = 0;
        if (this.playing) this.under++;
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

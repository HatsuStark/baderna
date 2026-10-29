// Redução de ruído com IA (RNNoise, via @jitsi/rnnoise-wasm). Roda antes do
// portão, no thread de áudio. Tira teclado, ventilador, rua etc. e, de quebra,
// diz a cada 10 ms a chance de ser voz (0–1); isso vai direto pro portão por
// um MessagePort, sem passar pelo thread principal.
//
// A RNNoise trabalha em quadros de 480 amostras a 48 kHz e o Web Audio em
// blocos de 128: entra num acumulador e sai com um quadro (10 ms) de atraso.

import createRNNWasmModuleSync from '../node_modules/@jitsi/rnnoise-wasm/dist/rnnoise-sync.js';

const FRAME = 480;
const SCALE = 32768; // a RNNoise espera amostras na escala de 16 bits
const RING = 2048;

class DenoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rnn = createRNNWasmModuleSync();
    this.ctx = this.rnn._rnnoise_create();
    this.inPtr = this.rnn._malloc(FRAME * 4);
    this.outPtr = this.rnn._malloc(FRAME * 4);
    this.frame = new Float32Array(FRAME);
    this.fill = 0;
    // Fila de saída já começa com um quadro de silêncio: nunca fica vazia.
    this.ring = new Float32Array(RING);
    this.read = 0;
    this.write = FRAME;
    this.vadPort = null;
    this.port.onmessage = (e) => {
      if (e.data?.vadPort) this.vadPort = e.data.vadPort;
    };
  }

  runFrame() {
    const heap = this.rnn.HEAPF32; // pode mudar se a memória crescer
    const inAt = this.inPtr >> 2;
    for (let i = 0; i < FRAME; i++) heap[inAt + i] = this.frame[i] * SCALE;
    const vad = this.rnn._rnnoise_process_frame(this.ctx, this.outPtr, this.inPtr);
    const out = this.rnn.HEAPF32;
    const outAt = this.outPtr >> 2;
    for (let i = 0; i < FRAME; i++) {
      this.ring[this.write] = out[outAt + i] / SCALE;
      this.write = (this.write + 1) % RING;
    }
    this.vadPort?.postMessage(vad);
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.frame[this.fill++] = input[i];
      if (this.fill === FRAME) {
        this.runFrame();
        this.fill = 0;
      }
    }
    for (let i = 0; i < input.length; i++) {
      const v = this.ring[this.read];
      this.read = (this.read + 1) % RING;
      for (const ch of output) ch[i] = v;
    }
    return true;
  }
}

registerProcessor('mic-denoise', DenoiseProcessor);

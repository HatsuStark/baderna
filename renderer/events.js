'use strict';

// Eventos do calendário. Cada um é só um bloco em EVENTS; fora das datas, o app
// volta ao normal sozinho e nada do evento fica salvo no boneco de ninguém.
//
// Pra criar um evento, copie este modelo:
//   {
//     id: 'natal',                 // também é a classe no <html>: cores em style.css (.natal)
//     start: [12, 24], end: [12, 26], // [mês, dia], inclusive. Pode virar o ano.
//     theme: 'natal',              // id de THEMES (themes.js): entra sozinho no lobby e nas salas
//     costumes: ['papai-noel'],    // ids de PREMIUM_SKINS (avatar.js) e obrigatórias: sorteia ao
//                                  // entrar e o editor só mostra estas. null: boneco normal.
//     welcome: 'Hoje você é {c}.', // aviso no chat ao entrar; {c} = nome da fantasia
//     sounds: { join: 'sino', leave: 'sino' }, // ids de EVENT_SOUNDS; sem isso, o bipe normal
//   }
// O dia vem do relógio de cada PC, então vale deixar um dia de folga pra fuso.

const EVENTS = [
  {
    id: 'halloween',
    start: [10, 30],
    end: [11, 1],
    theme: 'halloween',
    costumes: ['jason', 'myers', 'freddy', 'leatherface', 'ghostface', 'chucky', 'art', 'pinhead', 'pennywise', 'dracula', 'frankenstein', 'sadako',
      'alien', 'jigsaw', 'annabelle', 'valak', 'regan', 'tubarao', 'hannibal', 'lobisomem', 'mumia', 'predador'],
    welcome: '🎃 Hoje você é {c}. Dá pra trocar em "Editar".',
    sounds: { join: 'uivo', leave: 'grito' },
  },
];

function eventOn(date) {
  const day = (date.getMonth() + 1) * 100 + date.getDate();
  return EVENTS.find(({ start, end }) => {
    const [from, to] = [start[0] * 100 + start[1], end[0] * 100 + end[1]];
    return from <= to ? day >= from && day <= to : day >= from || day <= to;
  }) ?? null;
}

const ACTIVE_EVENT = eventOn(new Date());
const EVENT_COSTUMES = ACTIVE_EVENT?.costumes ?? null;

// Sons de entrar/sair dos eventos, gerados na hora (sem arquivo de áudio): cada
// um recebe o contexto, a saída e o instante de início. Mantenha em 1 a 2 s.
const EVENT_SOUNDS = {
  // Uivo: sobe devagar, segura com vibrato crescente e cai no fim, com eco de longe.
  uivo(ctx, out, t) {
    const end = t + 1.8;
    const pitch = ctx.createConstantSource();
    pitch.offset.setValueAtTime(300, t);
    pitch.offset.exponentialRampToValueAtTime(610, t + 0.45);
    pitch.offset.setValueAtTime(610, t + 1.15);
    pitch.offset.exponentialRampToValueAtTime(400, end);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 5.2;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.setValueAtTime(0, t);
    wobbleDepth.gain.linearRampToValueAtTime(14, t + 1.1);

    const throat = ctx.createBiquadFilter();
    throat.type = 'lowpass';
    throat.frequency.value = 1400;
    const mouth = ctx.createBiquadFilter();
    mouth.type = 'peaking';
    mouth.frequency.value = 800;
    mouth.Q.value = 2;
    mouth.gain.value = 9;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.15, t + 0.3);
    env.gain.setValueAtTime(0.15, t + 1.15);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    const oscs = [['triangle', 1, 0.8], ['sawtooth', 1.004, 0.12], ['sine', 2, 0.08]].map(([type, ratio, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 0;
      const mult = ctx.createGain();
      mult.gain.value = ratio;
      pitch.connect(mult).connect(osc.frequency);
      wobbleDepth.connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(throat);
      return osc;
    });
    throat.connect(mouth).connect(env).connect(out);

    const echo = ctx.createDelay(0.5);
    echo.delayTime.value = 0.2;
    const echoLevel = ctx.createGain();
    echoLevel.gain.value = 0.28;
    env.connect(echo).connect(echoLevel).connect(out);

    wobble.connect(wobbleDepth);
    for (const node of [pitch, wobble, ...oscs]) {
      node.start(t);
      node.stop(end);
    }
  },

  // Grito: ataque seco, tom agudo instável e rouquidão (modulação rápida do
  // volume, que é o que faz soar como grito e não como apito), passando por
  // ressonâncias de vogal aberta.
  grito(ctx, out, t) {
    const end = t + 1.5;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(760, t);
    osc.frequency.exponentialRampToValueAtTime(1180, t + 0.1);
    osc.frequency.setValueAtTime(1180, t + 1);
    osc.frequency.exponentialRampToValueAtTime(720, end);
    const shake = ctx.createOscillator();
    shake.frequency.value = 11;
    const shakeDepth = ctx.createGain();
    shakeDepth.gain.value = 55;
    shake.connect(shakeDepth).connect(osc.frequency);

    const noise = ctx.createBufferSource();
    const samples = new Float32Array(Math.ceil(ctx.sampleRate * 1.5));
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    noise.buffer = buffer;
    const noiseLevel = ctx.createGain();
    noiseLevel.gain.value = 0.12;

    const voice = ctx.createGain();
    voice.gain.value = 0.7;
    const rough = ctx.createOscillator();
    rough.frequency.value = 73;
    const roughDepth = ctx.createGain();
    roughDepth.gain.value = 0.3;
    rough.connect(roughDepth).connect(voice.gain);
    osc.connect(voice);
    noise.connect(noiseLevel).connect(voice);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.55, t + 0.04);
    env.gain.setValueAtTime(0.55, t + 1);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const [freq, q, level] of [[1100, 7, 1], [1750, 8, 0.7], [3000, 9, 0.35]]) {
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = freq;
      formant.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      voice.connect(formant).connect(g).connect(env);
    }
    env.connect(out);

    for (const node of [osc, shake, noise, rough]) {
      node.start(t);
      node.stop(end);
    }
  },
};

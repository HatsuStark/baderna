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
// Opcionais:
//   when: (d) => ...      // no lugar de start/end, pra data que muda (sexta 13, Carnaval)
//   special: 'jason',     // fantasia rara: no máximo uma na sala, sorteada 1 em 3 (rollCostume)
//   welcomeSpecial: '…',  // aviso pra quem tirou a especial
//   narration: { arrived: [...], left: [...], dropped: [...] }, // frases extras do narrador
// O dia vem do relógio de cada PC, então vale deixar um dia de folga pra fuso.

const EVENTS = [
  {
    id: 'sexta13',
    when: (d) => d.getDay() === 5 && d.getDate() === 13,
    theme: 'acampamento',
    costumes: ['monitor-apito', 'monitor-lanterna', 'monitor-violao', 'monitor-marshmallow', 'monitor-remo', 'jason'],
    special: 'jason',
    welcome: '🔪 Sexta-feira 13 no acampamento. Hoje você é {c}. Ninguém vai sozinho buscar lenha.',
    welcomeSpecial: '🔪 Sexta-feira 13. Você é {c}. Finge que é monitor, ninguém vai perceber.',
    sounds: { join: 'sussurro', leave: 'facao' },
    narration: {
      arrived: ['{n} chegou no acampamento. Alguém conta quantos somos.', '{n} chegou bem na hora que a luz piscou.',
        '{n} chegou de canoa. Do outro lado do lago. Sozinho.'],
      left: ['{n} disse "já volto". Clássico.', '{n} foi sozinho buscar lenha. Péssima ideia.',
        '{n} foi ver que barulho foi aquele lá fora.', '{n} foi nadar no lago à meia-noite.'],
      dropped: ['{n} sumiu na neblina.', 'Um gato preto cruzou o cabo de {n}.', '{n} quebrou um espelho e caiu da sala.'],
    },
  },

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
  return EVENTS.find(({ start, end, when }) => {
    if (when) return when(date);
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

  // Sussurro "ki ki ki... ma ma ma": voz só de ar (ruído passando por
  // ressonâncias de vogal), com eco de mata fechada.
  sussurro(ctx, out, t) {
    const noise = noiseBuffer(ctx, 0.5);
    const voice = ctx.createGain();
    voice.gain.value = 0.6;
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.24;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.26;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    voice.connect(out);
    voice.connect(echo).connect(tone).connect(feedback).connect(echo);
    tone.connect(out);

    // Um sopro: ruído com envelope, somado por filtros em paralelo.
    const breath = (at, dur, attack, level, bands) => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.linearRampToValueAtTime(level, at + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      for (const [type, freq, q, gain] of bands) {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(f).connect(g).connect(env);
      }
      env.connect(voice);
      src.start(at, Math.random() * 0.3);
      src.stop(at + dur + 0.02);
    };
    const ki = (at) => {
      breath(at, 0.035, 0.003, 1, [['highpass', 2800, 0.7, 0.5]]);
      breath(at + 0.025, 0.08, 0.01, 1, [['bandpass', 2400, 6, 1.6], ['bandpass', 3200, 8, 1.2]]);
    };
    const ma = (at) => {
      breath(at, 0.05, 0.02, 1, [['bandpass', 260, 4, 1.4]]);
      breath(at + 0.04, 0.14, 0.03, 1, [['bandpass', 750, 5, 1.8], ['bandpass', 1200, 6, 1.4], ['bandpass', 2600, 9, 0.6]]);
    };
    [0, 0.11, 0.22].forEach((d) => ki(t + d));
    [0.44, 0.62, 0.8].forEach((d) => ma(t + d));
  },

  // Facão: zunido cortando o ar, pancada seca na madeira e o metal vibrando.
  facao(ctx, out, t) {
    const hit = t + 0.26;
    const swoosh = ctx.createBufferSource();
    swoosh.buffer = noiseBuffer(ctx, 0.4);
    const sweep = ctx.createBiquadFilter();
    sweep.type = 'bandpass';
    sweep.Q.value = 1.6;
    sweep.frequency.setValueAtTime(500, t);
    sweep.frequency.exponentialRampToValueAtTime(4800, hit);
    const swooshEnv = ctx.createGain();
    swooshEnv.gain.setValueAtTime(0.0001, t);
    swooshEnv.gain.exponentialRampToValueAtTime(0.5, hit - 0.04);
    swooshEnv.gain.exponentialRampToValueAtTime(0.0001, hit + 0.02);
    swoosh.connect(sweep).connect(swooshEnv).connect(out);
    swoosh.start(t);
    swoosh.stop(hit + 0.05);

    const thud = ctx.createOscillator();
    thud.frequency.setValueAtTime(130, hit);
    thud.frequency.exponentialRampToValueAtTime(48, hit + 0.18);
    const thudEnv = ctx.createGain();
    thudEnv.gain.setValueAtTime(0.0001, hit);
    thudEnv.gain.linearRampToValueAtTime(0.42, hit + 0.005);
    thudEnv.gain.exponentialRampToValueAtTime(0.0001, hit + 0.3);
    thud.connect(thudEnv).connect(out);
    thud.start(hit);
    thud.stop(hit + 0.32);

    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx, 0.1);
    const crackTone = ctx.createBiquadFilter();
    crackTone.type = 'highpass';
    crackTone.frequency.value = 1200;
    const crackEnv = ctx.createGain();
    crackEnv.gain.setValueAtTime(0.3, hit);
    crackEnv.gain.exponentialRampToValueAtTime(0.0001, hit + 0.06);
    crack.connect(crackTone).connect(crackEnv).connect(out);
    crack.start(hit);
    crack.stop(hit + 0.08);

    for (const [freq, level, decay] of [[2340, 0.05, 1.1], [2352, 0.04, 1], [3530, 0.03, 0.8], [5100, 0.015, 0.5]]) {
      const ring = ctx.createOscillator();
      ring.frequency.value = freq;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, hit);
      env.gain.linearRampToValueAtTime(level, hit + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, hit + decay);
      ring.connect(env).connect(out);
      ring.start(hit);
      ring.stop(hit + decay + 0.02);
    }
  },
};

function noiseBuffer(ctx, seconds) {
  const samples = new Float32Array(Math.ceil(ctx.sampleRate * seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

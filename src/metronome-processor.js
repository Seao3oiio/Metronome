const SOUND_NAMES = ["click", "wood", "drum", "soft"];

const clampBpm = (value) =>
  Math.min(240, Math.max(30, Math.round(Number(value) || 0)));

const nextTrainingBpm = (current, target, step) => {
  const direction = Math.sign(target - current);
  if (!direction) return current;
  const next = current + direction * Math.max(1, step);
  return direction > 0 ? Math.min(next, target) : Math.max(next, target);
};

export class KessokuMetronomeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.playing = false;
    this.samples = {};
    this.voices = Object.create(null);
    this.events = [];
    this.eventIndex = 0;
    this.positionTicks = 0;
    this.totalTicks = 0;
    this.ppq = 192;
    this.bpm = 96;
    this.sound = "click";
    this.countInBeats = 0;
    this.countInBeat = 0;
    this.nextCountInTick = 0;
    this.countInFinished = true;
    this.barsPlayed = 0;
    this.playedFrames = 0;
    this.minuteDeadline = 60;
    this.trainer = false;
    this.changeMode = "bars";
    this.changeEvery = 4;
    this.changeAmount = 10;
    this.targetBpm = 120;
    this.outputTime = 0;

    this.port.onmessage = ({ data }) => {
      if (data?.type === "configure") {
        this.configure(data);
      } else if (data?.type === "update") {
        this.update(data);
      } else if (data?.type === "pause") {
        this.playing = false;
        this.voices = Object.create(null);
      } else if (data?.type === "resume") {
        if (this.active) this.playing = true;
      } else if (data?.type === "reset-training") {
        this.barsPlayed = 0;
        this.minuteDeadline = this.playedFrames / sampleRate + 60;
      } else if (data?.type === "stop") {
        this.active = false;
        this.playing = false;
        this.voices = Object.create(null);
      }
    };
  }

  applySettings(data) {
    this.bpm = clampBpm(data.bpm ?? this.bpm);
    this.sound = SOUND_NAMES.includes(data.sound) ? data.sound : "click";
    this.trainer = Boolean(data.trainer);
    this.changeMode = data.changeMode === "minute" ? "minute" : "bars";
    this.changeEvery = Math.max(1, Math.round(Number(data.changeEvery) || 4));
    this.changeAmount = Math.max(1, Math.round(Number(data.changeAmount) || 10));
    this.targetBpm = clampBpm(data.targetBpm ?? this.targetBpm);
  }

  configure(data) {
    this.applySettings(data);
    this.samples = data.sampleBank ?? {};
    this.events = Array.isArray(data.events) ? data.events : [];
    this.totalTicks = Math.max(1, Number(data.totalTicks) || 1);
    this.ppq = Math.max(1, Number(data.ppq) || 192);
    this.countInBeats = Math.max(0, Math.round(Number(data.countInBeats) || 0));
    this.positionTicks = -this.countInBeats * this.ppq;
    this.nextCountInTick = this.positionTicks;
    this.countInBeat = 0;
    this.countInFinished = this.countInBeats === 0;
    this.eventIndex = 0;
    this.barsPlayed = 0;
    this.playedFrames = 0;
    this.minuteDeadline = 60;
    this.voices = Object.create(null);
    this.active = true;
    this.playing = true;
    this.port.postMessage({ type: "ready" });
  }

  update(data) {
    this.applySettings(data);
    if (!Array.isArray(data.events) || !Number.isFinite(data.totalTicks)) return;

    const sameTimeline =
      data.events.length === this.events.length &&
      Number(data.totalTicks) === this.totalTicks &&
      data.events.every((event, index) => event.ticks === this.events[index]?.ticks);
    this.events = data.events;
    this.totalTicks = Math.max(1, Number(data.totalTicks));
    if (!sameTimeline && this.positionTicks >= 0) {
      this.positionTicks %= this.totalTicks;
      const nextIndex = this.events.findIndex(
        (event) => event.ticks > this.positionTicks + 1e-6,
      );
      this.eventIndex = nextIndex < 0 ? this.events.length : nextIndex;
    }
  }

  addVoice(sound, accented, velocity) {
    const name = SOUND_NAMES.includes(sound) ? sound : "click";
    const sample = this.samples[`${name}:${accented ? "accent" : "normal"}`];
    if (!(sample instanceof Float32Array) || sample.length === 0) return;
    this.voices[name] = { sample, frame: 0, velocity };
  }

  updateTrainer(event) {
    if (!this.trainer || event.beat !== 0 || event.sub !== 0) return;
    const elapsed = this.playedFrames / sampleRate;
    const barsDue =
      this.changeMode === "bars" &&
      this.barsPlayed > 0 &&
      this.barsPlayed % this.changeEvery === 0;
    const minuteDue = this.changeMode === "minute" && elapsed >= this.minuteDeadline;
    if (minuteDue) {
      this.minuteDeadline +=
        (Math.floor((elapsed - this.minuteDeadline) / 60) + 1) * 60;
    }
    if (barsDue || minuteDue) {
      const next = nextTrainingBpm(this.bpm, this.targetBpm, this.changeAmount);
      if (next !== this.bpm) {
        this.bpm = next;
        this.port.postMessage({ type: "tempo", bpm: next });
      }
    }
    this.barsPlayed += 1;
  }

  postVisual(visual) {
    this.port.postMessage({
      type: "visual",
      audioTime: this.outputTime,
      visual,
    });
  }

  triggerCountIn() {
    this.addVoice(
      this.sound,
      this.countInBeat === 0,
      this.countInBeat === 0 ? 1 : 0.74,
    );
    this.postVisual({
      bar: null,
      beat: this.countInBeat,
      sub: 0,
      hit: true,
      gap: false,
    });
    this.countInBeat += 1;
    this.nextCountInTick += this.ppq;
  }

  triggerEvent(event) {
    this.updateTrainer(event);
    const gap = Boolean(event.gap);
    const hit = !gap && event.step > 0;
    if (hit) {
      this.addVoice(
        this.sound,
        event.step === 2,
        event.step === 2 ? 1 : 0.82,
      );
    }
    this.postVisual({
      bar: event.bar,
      beat: event.beat,
      sub: event.sub,
      hit,
      gap,
    });
  }

  advanceTimeline() {
    if (this.positionTicks < 0) {
      while (
        this.countInBeat < this.countInBeats &&
        this.nextCountInTick <= this.positionTicks + 1e-6
      ) {
        this.triggerCountIn();
      }
      return;
    }

    if (!this.countInFinished) {
      this.countInFinished = true;
      this.port.postMessage({
        type: "count-in-ended",
        audioTime: this.outputTime,
      });
    }

    while (this.positionTicks >= this.totalTicks) {
      this.positionTicks -= this.totalTicks;
      this.eventIndex = 0;
    }
    while (
      this.eventIndex < this.events.length &&
      this.events[this.eventIndex].ticks <= this.positionTicks + 1e-6
    ) {
      this.triggerEvent(this.events[this.eventIndex]);
      this.eventIndex += 1;
    }
  }

  renderVoices() {
    let mixed = 0;
    for (const name of SOUND_NAMES) {
      const voice = this.voices[name];
      if (!voice) continue;
      if (voice.frame >= voice.sample.length) {
        this.voices[name] = null;
        continue;
      }
      mixed += voice.sample[voice.frame] * voice.velocity;
      voice.frame += 1;
    }
    return Math.max(-1, Math.min(1, mixed));
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    const frames = channels[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      let value = 0;
      this.outputTime = currentTime + frame / sampleRate;
      if (this.active && this.playing) {
        this.advanceTimeline();
        value = this.renderVoices();
        this.positionTicks += (this.bpm * this.ppq) / (60 * sampleRate);
        this.playedFrames += 1;
      }
      for (const channel of channels) channel[frame] = value;
    }
    return true;
  }
}

registerProcessor("kessoku-metronome", KessokuMetronomeProcessor);

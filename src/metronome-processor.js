const TRACK_SOUNDS = {
  click: { accent: 1660, normal: 1080, duration: 0.025 },
  wood: { accent: 820, normal: 610, duration: 0.045 },
  drum: { accent: 180, normal: 120, duration: 0.07 },
  soft: { accent: 940, normal: 720, duration: 0.04 },
};

const RHYTHM_TRACK_SOUNDS = {
  click: "drum",
  wood: "drum",
  drum: "click",
  soft: "drum",
};

const clampBpm = (value) =>
  Math.min(240, Math.max(30, Math.round(Number(value) || 0)));

const nextTrainingBpm = (current, target, step) => {
  const direction = Math.sign(target - current);
  if (!direction) return current;
  const next = current + direction * Math.max(1, step);
  return direction > 0 ? Math.min(next, target) : Math.max(next, target);
};

class KessokuMetronomeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.playing = false;
    this.voices = [];
    this.events = [];
    this.eventIndex = 0;
    this.positionTicks = 0;
    this.totalTicks = 0;
    this.ppq = 192;
    this.bpm = 96;
    this.sound = "click";
    this.beatTrack = true;
    this.rhythmTrack = true;
    this.distinguishOffbeats = true;
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

    this.port.onmessage = ({ data }) => {
      if (data?.type === "configure") {
        this.configure(data);
      } else if (data?.type === "update") {
        this.update(data);
      } else if (data?.type === "pause") {
        this.playing = false;
        this.voices = [];
      } else if (data?.type === "resume") {
        if (this.active) this.playing = true;
      } else if (data?.type === "reset-training") {
        this.barsPlayed = 0;
        this.minuteDeadline = this.playedFrames / sampleRate + 60;
      } else if (data?.type === "stop") {
        this.active = false;
        this.playing = false;
        this.voices = [];
      }
    };
  }

  applySettings(data) {
    this.bpm = clampBpm(data.bpm ?? this.bpm);
    this.sound = TRACK_SOUNDS[data.sound] ? data.sound : "click";
    this.beatTrack = data.beatTrack !== false;
    this.rhythmTrack = data.rhythmTrack !== false;
    this.distinguishOffbeats = data.distinguishOffbeats !== false;
    this.trainer = Boolean(data.trainer);
    this.changeMode = data.changeMode === "minute" ? "minute" : "bars";
    this.changeEvery = Math.max(1, Math.round(Number(data.changeEvery) || 4));
    this.changeAmount = Math.max(1, Math.round(Number(data.changeAmount) || 10));
    this.targetBpm = clampBpm(data.targetBpm ?? this.targetBpm);
  }

  configure(data) {
    this.applySettings(data);
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
    this.voices = [];
    this.active = true;
    this.playing = true;
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
    const name = TRACK_SOUNDS[sound] ? sound : "click";
    const definition = TRACK_SOUNDS[name];
    this.voices.push({
      sound: name,
      frequency: accented ? definition.accent : definition.normal,
      duration: definition.duration,
      velocity,
      frame: 0,
    });
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

  triggerCountIn() {
    this.addVoice(this.sound, this.countInBeat === 0, this.countInBeat === 0 ? 1 : 0.74);
    this.port.postMessage({
      type: "visual",
      visual: {
        bar: null,
        beat: this.countInBeat,
        sub: 0,
        hit: true,
        gap: false,
      },
    });
    this.countInBeat += 1;
    this.nextCountInTick += this.ppq;
  }

  triggerEvent(event) {
    this.updateTrainer(event);
    const gap = Boolean(event.gap);
    let hit = false;

    if (!gap && this.beatTrack && event.sub === 0) {
      this.addVoice(
        this.sound,
        event.beat === 0,
        event.beat === 0 ? 0.62 : 0.34,
      );
      hit = true;
    }
    if (!gap && this.rhythmTrack && event.step > 0) {
      const rhythmSound =
        this.beatTrack || (this.distinguishOffbeats && event.sub > 0)
          ? RHYTHM_TRACK_SOUNDS[this.sound]
          : this.sound;
      this.addVoice(
        rhythmSound,
        event.step === 2,
        event.step === 2 ? 1 : 0.82,
      );
      hit = true;
    }

    this.port.postMessage({
      type: "visual",
      visual: {
        bar: event.bar,
        beat: event.beat,
        sub: event.sub,
        hit,
        gap,
      },
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
      this.port.postMessage({ type: "count-in-ended" });
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
    const remaining = [];
    for (const voice of this.voices) {
      const time = voice.frame / sampleRate;
      if (time >= voice.duration) continue;
      const phase = 2 * Math.PI * voice.frequency * time;
      const wave =
        voice.sound === "click"
          ? (2 / Math.PI) * Math.asin(Math.sin(phase))
          : voice.sound === "wood"
            ? (Math.sin(phase) + 0.35 * Math.sin(phase * 3)) / 1.35
            : Math.sin(
                voice.sound === "drum"
                  ? phase * (1.8 - (0.8 * time) / voice.duration)
                  : phase,
              );
      const envelope =
        Math.min(1, time / 0.001) * Math.exp((-6 * time) / voice.duration);
      mixed += wave * envelope * voice.velocity * 0.75;
      voice.frame += 1;
      remaining.push(voice);
    }
    this.voices = remaining;
    return Math.max(-1, Math.min(1, mixed));
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    const frames = channels[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      let value = 0;
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

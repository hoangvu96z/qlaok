'use client';

export type ChimeSoundId =
  | 'kitchen_gong'
  | 'siren_urgent'
  | 'voice_vi'
  | 'melody_upbeat'
  | 'bell_classic';

export type ChimeVolumePreset = 'normal' | 'loud' | 'max_boost';

export interface OrderChimeSettings {
  enabled: boolean;
  soundId: ChimeSoundId;
  volumePreset: ChimeVolumePreset;
  repeatCount: 1 | 2 | 3;
  remindUntilAccepted: boolean;
}

export const DEFAULT_CHIME_SETTINGS: OrderChimeSettings = {
  enabled: true,
  soundId: 'kitchen_gong',
  volumePreset: 'max_boost',
  repeatCount: 2,
  remindUntilAccepted: true,
};

const STORAGE_KEY = 'qlaok_order_chime_settings_v1';

export const CHIME_SOUND_OPTIONS: Array<{
  id: ChimeSoundId;
  label: string;
  desc: string;
  badge?: string;
}> = [
  {
    id: 'kitchen_gong',
    label: '🛎️ Chuông Bếp 3 Hồi Lớn (Khuyên dùng)',
    desc: 'Tiếng chuông kim loại 3 hồi vang rõ, xuyên qua tiếng ồn nhà bếp',
    badge: 'Rõ & Vang',
  },
  {
    id: 'siren_urgent',
    label: '🚨 Còi Báo Đơn Khẩn Cấp (Siêu To)',
    desc: 'Âm báo tần số cao kết hợp sóng vuông cực lớn cho quán đông / ồn ào',
    badge: 'To Nhất',
  },
  {
    id: 'voice_vi',
    label: '🗣️ Chuông + Giọng Đọc Tiếng Việt',
    desc: 'Đổ chuông kèm giọng đọc: "Có đơn hàng mới, xin kiểm tra!"',
    badge: 'Giọng đọc',
  },
  {
    id: 'melody_upbeat',
    label: '🎵 Nhạc Chuông POS Hiện Đại',
    desc: 'Giai điệu 4 nốt tươi vui chuyên nghiệp cho quầy thu ngân cafe / trà sữa',
  },
  {
    id: 'bell_classic',
    label: '🔔 Chuông Quầy Ding-Dong Nhẹ Nhàng',
    desc: 'Âm báo 2 nốt thanh lịch cho spa, salon hoặc quán yên tĩnh',
  },
];

export function loadOrderChimeSettings(): OrderChimeSettings {
  if (typeof window === 'undefined') return DEFAULT_CHIME_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHIME_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CHIME_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_CHIME_SETTINGS;
  }
}

export function saveOrderChimeSettings(settings: OrderChimeSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

function getGainMultiplier(preset: ChimeVolumePreset): number {
  if (preset === 'normal') return 0.35;
  if (preset === 'loud') return 0.7;
  return 1.0; // max_boost uses compressor + rich harmonics at full 1.0 gain
}

function playSingleBurst(
  ctx: AudioContext,
  masterOut: AudioNode,
  soundId: ChimeSoundId,
  volumePreset: ChimeVolumePreset,
  startOffsetSec: number
): number {
  const gainLevel = getGainMultiplier(volumePreset);
  const isBoost = volumePreset === 'max_boost';

  const scheduleTone = (
    freq: number,
    startSec: number,
    durationSec: number,
    type: OscillatorType = 'sine',
    relativeVol = 1
  ) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    const t0 = ctx.currentTime + startOffsetSec + startSec;
    osc.frequency.setValueAtTime(freq, t0);

    const peak = Math.min(1, gainLevel * relativeVol);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + durationSec);

    osc.connect(gain);
    gain.connect(masterOut);
    osc.start(t0);
    osc.stop(t0 + durationSec + 0.02);

    // Add harmonic overtone layer when in max_boost or loud mode for extra perceived loudness
    if (isBoost || volumePreset === 'loud') {
      const overtone = ctx.createOscillator();
      const overGain = ctx.createGain();
      overtone.type = isBoost ? 'square' : 'triangle';
      overtone.frequency.setValueAtTime(freq * 2, t0);
      const overPeak = peak * (isBoost ? 0.45 : 0.22);
      overGain.gain.setValueAtTime(0.001, t0);
      overGain.gain.linearRampToValueAtTime(overPeak, t0 + 0.01);
      overGain.gain.exponentialRampToValueAtTime(0.0008, t0 + durationSec * 0.85);
      overtone.connect(overGain);
      overGain.connect(masterOut);
      overtone.start(t0);
      overtone.stop(t0 + durationSec);
    }
  };

  if (soundId === 'kitchen_gong') {
    // 3 rapid loud metallic bell strikes (A5 -> C#6 -> E6)
    scheduleTone(880, 0, 0.28, 'triangle', 1);
    scheduleTone(1760, 0, 0.22, 'sine', 0.6);
    scheduleTone(1108.73, 0.22, 0.28, 'triangle', 1);
    scheduleTone(2217.46, 0.22, 0.22, 'sine', 0.6);
    scheduleTone(1318.51, 0.44, 0.55, 'triangle', 1);
    scheduleTone(2637.02, 0.44, 0.45, 'sine', 0.7);
    return 1.05;
  }

  if (soundId === 'siren_urgent') {
    // High-penetration alternating dual-tone kitchen alarm
    const pulses = [0, 0.16, 0.32, 0.48, 0.64, 0.8];
    pulses.forEach((p, idx) => {
      const f = idx % 2 === 0 ? 987.77 : 1318.51; // B5 <-> E6
      scheduleTone(f, p, 0.15, isBoost ? 'sawtooth' : 'square', 1);
    });
    return 1.05;
  }

  if (soundId === 'melody_upbeat') {
    // Upbeat 4-note POS melody (C5 - E5 - G5 - C6)
    scheduleTone(523.25, 0, 0.16, 'triangle', 0.9);
    scheduleTone(659.25, 0.14, 0.16, 'triangle', 0.9);
    scheduleTone(783.99, 0.28, 0.18, 'triangle', 0.95);
    scheduleTone(1046.5, 0.44, 0.45, 'triangle', 1);
    return 0.95;
  }

  if (soundId === 'voice_vi') {
    // Attention chime first, then Vietnamese voice synthesis
    scheduleTone(783.99, 0, 0.2, 'triangle', 1);
    scheduleTone(1046.5, 0.18, 0.35, 'triangle', 1);
    return 0.65;
  }

  // Default: 'bell_classic' (Ding-Dong E5 -> A5)
  scheduleTone(659.25, 0, 0.22, 'sine', 0.95);
  scheduleTone(880, 0.2, 0.45, 'sine', 1);
  return 0.7;
}

export function playOrderAlertChime(
  customSettings?: Partial<OrderChimeSettings>,
  tableLabel?: string
): void {
  if (typeof window === 'undefined') return;
  const settings: OrderChimeSettings = {
    ...loadOrderChimeSettings(),
    ...customSettings,
  };
  if (!settings.enabled) return;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();

      // Use a DynamicsCompressorNode + Master Gain so max_boost is genuinely loud without harsh clipping
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-18, ctx.currentTime);
      compressor.knee.setValueAtTime(12, ctx.currentTime);
      compressor.ratio.setValueAtTime(6, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.15, ctx.currentTime);

      const masterGain = ctx.createGain();
      const boostFactor =
        settings.volumePreset === 'max_boost'
          ? 2.4
          : settings.volumePreset === 'loud'
            ? 1.45
            : 0.85;
      masterGain.gain.setValueAtTime(boostFactor, ctx.currentTime);

      compressor.connect(masterGain);
      masterGain.connect(ctx.destination);

      const repeats = settings.soundId === 'voice_vi' ? 1 : settings.repeatCount || 1;
      let offset = 0;
      for (let i = 0; i < repeats; i++) {
        const dur = playSingleBurst(
          ctx,
          compressor,
          settings.soundId,
          settings.volumePreset,
          offset
        );
        offset += dur + 0.12;
      }
    }

    // Trigger Vietnamese SpeechSynthesis if voice_vi is selected
    if (settings.soundId === 'voice_vi' && 'speechSynthesis' in window) {
      setTimeout(() => {
        try {
          window.speechSynthesis.cancel();
          const text = tableLabel
            ? `Có đơn hàng mới từ ${tableLabel}, xin kiểm tra!`
            : 'Có đơn hàng mới tại quầy, xin kiểm tra!';
          const utter = new SpeechSynthesisUtterance(text);
          utter.lang = 'vi-VN';
          utter.rate = 1.05;
          utter.volume = 1.0;
          window.speechSynthesis.speak(utter);
        } catch {
          // ignore speech synthesis errors
        }
      }, 450);
    }
  } catch {
    // ignore audio autoplay restrictions
  }
}

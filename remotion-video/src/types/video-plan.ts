/**
 * VideoPlan: Contrato entre backend y Remotion
 * Define la estructura de datos que renderiza Remotion
 * independientemente de cómo se genere en backend
 */

export interface AudioConfig {
  voiceoverPath: string;
  musicPath?: string;
  musicVolume?: number; // 0-1, default 0.15
  voiceoverVolume?: number; // 0-1, default 0.95
}

export interface AvatarConfig {
  enabled: boolean;
  characterId: string; // 'default_videosia', 'premium_host', etc.
  position: 'bottom-right' | 'bottom-center' | 'bottom-left' | 'center-right' | 'full'; // donde aparece
  scale: number; // 1.0 = tamaño natural, 1.2 = 20% más grande
  expressionMode: 'beat_based' | 'word_based' | 'section_based' | 'static';
  lipSyncMode: 'none' | 'word_boundaries_basic' | 'advanced';
  assetPaths?: {
    neutral?: string;
    speaking?: string;
    emphasis?: string;
    surprised?: string;
    serious?: string;
    thinking?: string;
    excited?: string;
  };
  enableMicroMovement: boolean; // breathing, head tilt
  enableEyeMovement: boolean; // eye tracking
}

export interface CameraConfig {
  motion?: 'none' | 'slow_push_in' | 'slow_pullback' | 'slow_pan_left' | 'slow_pan_right' | 'parallax';
  intensity?: number; // 0-1
  zoomStart?: number; // 1.0 = sin zoom
  zoomEnd?: number;
}

export interface BackgroundConfig {
  type: 'video' | 'image' | 'color' | 'fallback' | 'dynamic_timeline';
  path?: string;
  color?: string; // hex
  opacity?: number; // 0-1
  blur?: number; // 0-50
  vignette?: number; // 0-1 intensidad
  brightness?: number; // -1 a 1
  contrast?: number; // -1 a 1
}

export interface CaptionBlock {
  id?: string;
  start: number; // segundos
  end: number;
  text: string;
  section?: 'hook' | 'claim' | 'revelation' | 'cta' | 'transition' | 'explanation';
  emphasis?: string[]; // palabras a destacar
  color?: string; // override color
  fontSize?: number; // override size
  effect?: 'fade_in' | 'slide_in' | 'bounce_in' | 'scale_in' | 'typewriter';
  effectDurationMs?: number;
}

export interface WordBoundary {
  word: string;
  startTime: number; // segundos
  endTime: number;
  wordIndex?: number;
}

export interface SceneBeat {
  id: string;
  start: number; // segundos
  end: number;
  type: 'hook' | 'claim' | 'revelation' | 'cta' | 'transition' | 'micro_value' | 'escalation';
  text?: string;
  avatarExpression?: 'neutral' | 'speaking' | 'emphasis' | 'surprised' | 'serious' | 'thinking' | 'excited';
  visualIntent?: string; // 'stop_scroll', 'maintain_attention', 'build_tension', 'release', etc.
  camera?: CameraConfig;
  background?: BackgroundConfig;
  overlay?: {
    type: 'text' | 'shape' | 'progress' | 'highlight';
    props?: Record<string, any>;
  };
  music?: {
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
  };
}

export interface StyleProfile {
  mood: 'cinematic' | 'energetic' | 'calm' | 'mysterious' | 'inspiring' | 'educational' | 'fun';
  energy: 'low' | 'medium' | 'high' | 'explosive';
  visualDensity: 'low' | 'medium' | 'medium-high' | 'high';
  colorMode: 'dark' | 'dark-premium' | 'light' | 'vibrant' | 'pastel' | 'monochrome';
  colorPalette?: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
}

export interface VideoPlan {
  // Metadata
  videoId: string;
  createdAt?: string;

  // Timing y formato
  durationSeconds: number;
  fps: number;
  format: 'shorts_9_16' | 'tiktok' | 'instagram_reel' | 'youtube_short';

  // Template y estilo
  template: 'avatar_explainer' | 'dark_documentary' | 'viral_facts' | 'cinematic_story' | 'explainer_premium' | 'custom';
  styleProfile: StyleProfile;

  // Contenido multimedia
  audio: AudioConfig;
  avatar: AvatarConfig;

  // Estructura visual y temporal
  scenes: SceneBeat[];
  captions: CaptionBlock[];
  wordBoundaries?: WordBoundary[]; // para lip-sync y timing

  // Metadata de contenido
  metadata?: {
    topic?: string;
    hook?: string;
    cta?: string;
    hashtags?: string[];
    contentType?: string;
    abVariant?: string;
  };
}

// Helper: Constructor minimal para compatibilidad
export function createMinimalVideoPlan(overrides: Partial<VideoPlan> = {}): VideoPlan {
  return {
    videoId: 'sample_' + Date.now(),
    durationSeconds: 30,
    fps: 30,
    format: 'shorts_9_16',
    template: 'avatar_explainer',
    styleProfile: {
      mood: 'cinematic',
      energy: 'high',
      visualDensity: 'medium-high',
      colorMode: 'dark-premium',
    },
    audio: {
      voiceoverPath: 'sample_voice.mp3',
      musicPath: undefined,
    },
    avatar: {
      enabled: true,
      characterId: 'default_videosia',
      position: 'bottom-right',
      scale: 1.15,
      expressionMode: 'beat_based',
      lipSyncMode: 'word_boundaries_basic',
      enableMicroMovement: true,
      enableEyeMovement: false,
    },
    scenes: [],
    captions: [],
    ...overrides,
  };
}

/**
 * Utilities para timing y sincronización de Remotion
 */

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

export function getCurrentTimeSeconds(frame: number, fps: number): number {
  return framesToSeconds(frame, fps);
}

export function isFrameInRange(
  frame: number,
  startSeconds: number,
  endSeconds: number,
  fps: number
): boolean {
  const startFrame = secondsToFrames(startSeconds, fps);
  const endFrame = secondsToFrames(endSeconds, fps);
  return frame >= startFrame && frame < endFrame;
}

export function getProgressInRange(
  frame: number,
  startSeconds: number,
  endSeconds: number,
  fps: number,
  clamp = true
): number {
  const startFrame = secondsToFrames(startSeconds, fps);
  const endFrame = secondsToFrames(endSeconds, fps);
  const range = endFrame - startFrame;
  let progress = (frame - startFrame) / range;

  if (clamp) {
    progress = Math.max(0, Math.min(1, progress));
  }

  return progress;
}

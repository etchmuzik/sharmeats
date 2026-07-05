export type MascotPose = 'cheer' | 'shrug' | 'wave' | 'snooze' | 'idle';

export interface PoseParams {
  mouthPath: string; // SVG path within a 100x100 viewBox, face centered ~ (50,52)
  eyeRy: number;     // eye vertical radius (open vs squinting)
  rayScale: number;  // sun-ray length multiplier
  rayRotate: number; // degrees the ray group is rotated
}

// Face lives in a 100x100 viewBox; sun body is a circle r=26 at (50,52).
const MOUTH_SMILE = 'M40 58 Q50 68 60 58';
const MOUTH_BIG = 'M38 56 Q50 72 62 56 Q50 64 38 56 Z';
const MOUTH_FLAT = 'M42 60 Q50 63 58 60';
const MOUTH_SMALL = 'M45 61 Q50 65 55 61';

export function getPose(pose: MascotPose): PoseParams {
  switch (pose) {
    case 'cheer': return { mouthPath: MOUTH_BIG, eyeRy: 4, rayScale: 1.25, rayRotate: 0 };
    case 'wave': return { mouthPath: MOUTH_SMILE, eyeRy: 4, rayScale: 1.1, rayRotate: 6 };
    case 'shrug': return { mouthPath: MOUTH_FLAT, eyeRy: 3.5, rayScale: 0.85, rayRotate: -4 };
    case 'snooze': return { mouthPath: MOUTH_SMALL, eyeRy: 1.2, rayScale: 0.9, rayRotate: 0 };
    case 'idle': default: return { mouthPath: MOUTH_SMILE, eyeRy: 4, rayScale: 1.0, rayRotate: 0 };
  }
}

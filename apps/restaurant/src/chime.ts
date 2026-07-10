/**
 * In-app new-order chime for the restaurant tablet.
 *
 * [H-REST1] The push notification (mig 040, sound:'default') is the PRIMARY
 * alert, but it's silent when notifications are denied, the tablet is in Expo
 * Go, or the push pipeline hiccups — yet the empty state promises "a sound
 * alert". This plays a bundled chime from the Realtime new-order insert,
 * independent of push, so a kitchen with the app open never misses an order.
 *
 * Uses expo-audio (SDK 52). Best-effort: any failure (no audio route, asset not
 * loaded yet) is swallowed — a missing chime must never break the order queue.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

let player: AudioPlayer | null = null;
let ready = false;
let muted = false;

/**
 * Suppress/allow the chime. Staff can mute from the header (e.g. a busy service).
 * Centralised here so BOTH the first-order chime and the repeat-until-acknowledged
 * loop honour a single flag — no caller can forget to check it.
 */
export function setChimeMuted(next: boolean): void {
  muted = next;
}

/** Preload the chime + configure playback to ignore the iOS silent switch. */
export async function initChime(): Promise<void> {
  if (ready) return;
  try {
    // Play through even when the device ringer is on silent (a counter tablet is
    // often muted) and don't duck other audio.
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    player = createAudioPlayer(require('../assets/new-order.wav'));
    ready = true;
  } catch {
    ready = false;
  }
}

/** Play the chime for a newly-arrived order. No-op if init failed or muted. */
export function playNewOrderChime(): void {
  if (muted || !ready || !player) return;
  try {
    player.seekTo(0);
    player.play();
  } catch {
    /* best-effort */
  }
}

/** Release the audio player (call on unmount). */
export function releaseChime(): void {
  try {
    player?.release();
  } catch {
    /* ignore */
  }
  player = null;
  ready = false;
}

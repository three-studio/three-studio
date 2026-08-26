import { drawWaveform } from '../../audio/waveform';
import type { AudioFacts } from './facts';
import type { PreviewSurface } from './PreviewSurface';

const WAVE_HEIGHT = 96;

/**
 * A waveform, and a button to hear it.
 *
 * The waveform earns its place for the same reason the image does: it is what
 * distinguishes a clip that starts with two seconds of silence, or that is
 * clipped to the ceiling, from one that is fine — and both are decisions about
 * the file rather than about the settings.
 *
 * Decoded through `AudioContext`, which also answers the three things worth
 * knowing about a sound file: how long, how many channels, at what rate.
 */
export class AudioPreview implements PreviewSurface {
  private context: AudioContext | null = null;
  private audio: HTMLAudioElement | null = null;
  private element: HTMLElement | null = null;
  private resize: ResizeObserver | null = null;

  async open(container: HTMLElement, url: string): Promise<AudioFacts | null> {
    const panel = document.createElement('div');
    panel.className = 'flex h-full w-full flex-col items-center justify-center gap-3 p-6';
    container.append(panel);
    this.element = panel;

    const canvas = document.createElement('canvas');
    canvas.className = 'w-full';
    canvas.height = WAVE_HEIGHT;
    panel.append(canvas);

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = url;
    audio.className = 'w-full';
    panel.append(audio);
    this.audio = audio;

    try {
      const response = await fetch(url);
      const bytes = await response.arrayBuffer();
      // Its own context, closed on dispose: the editor's audio graph belongs to
      // play mode, and a file that is not imported yet has no business in it.
      this.context = new AudioContext();
      const buffer = await this.context.decodeAudioData(bytes);
      drawWaveform(canvas, buffer);
      // A canvas is `w-full` in CSS but a fixed pixel buffer underneath, so a
      // panel that changes width leaves the waveform drawn at the old one —
      // stretched or cut, and visibly wrong now that the preview fills the
      // window rather than a 256 px band.
      this.resize = new ResizeObserver(() => drawWaveform(canvas, buffer));
      this.resize.observe(panel);
      return {
        kind: 'audio',
        seconds: buffer.duration,
        channels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate,
      };
    } catch {
      // Undecodable by this browser, which is not a reason to refuse the
      // import: the player it ships to may well handle it.
      canvas.remove();
      return null;
    }
  }

  dispose(): void {
    this.resize?.disconnect();
    this.resize = null;
    this.audio?.pause();
    void this.context?.close();
    this.context = null;
    this.element?.remove();
    this.element = null;
  }
}

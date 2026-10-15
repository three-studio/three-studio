import {
  DEVICE_LOG_BYTES,
  DEVICE_LOG_LINES,
  DEVICE_LOG_PENDING,
  cutLogText,
  type DeviceLogLevel,
  type DeviceLogLine,
} from '@three-studio/core/devices/protocol';

/*
 * The lines a page logged and has not sent yet, from its very first: they
 * wait here until the server knows the device, and while its link is down.
 *
 * Bounded, since a game can log every frame and a phone has little memory to
 * spare. A line logged again right after itself folds into it, as the
 * Console folds repeats; past `DEVICE_LOG_PENDING` lines a new one is counted
 * rather than kept, and the count reaches the editor with the next batch.
 */

/** What one POST carries. */
export interface LogBatch {
  lines: DeviceLogLine[];
  /** Lines lost since the last batch the server took. */
  dropped: number;
}

export interface LogQueue {
  push: (level: DeviceLogLevel, text: string) => void;
  /**
   * The oldest lines, as many as one batch holds — always at least one — with
   * the count of the lines lost meanwhile, which starts again from zero.
   * `null` when nothing waits and nothing was lost.
   */
  take: () => LogBatch | null;
  /** A batch lost on the way: its lines go back in front, and its count with them. */
  putBack: (batch: LogBatch) => void;
  /** A batch the server refused: everything it carried is lost, and counted. */
  lose: (batch: LogBatch) => void;
  /** Lines waiting. */
  readonly size: number;
}

export function createLogQueue(): LogQueue {
  let waiting: DeviceLogLine[] = [];
  let dropped = 0;
  const encoder = new TextEncoder();

  return {
    push(level, text) {
      const cut = cutLogText(text);
      // Not `at(-1)`: the client runs on phones older than ES2022.
      const last = waiting[waiting.length - 1];
      if (last !== undefined && last.level === level && last.text === cut) {
        last.count += 1;
        return;
      }
      // The earliest are kept: a cause comes before its consequences.
      if (waiting.length >= DEVICE_LOG_PENDING) {
        dropped += 1;
        return;
      }
      waiting.push({ level, text: cut, count: 1 });
    },

    take() {
      if (waiting.length === 0 && dropped === 0) return null;
      // Measured as the server will read it, JSON in UTF-8, so that a batch
      // of accented or CJK text stays under the body limit too.
      let bytes = 2;
      let count = 0;
      for (const line of waiting) {
        if (count === DEVICE_LOG_LINES) break;
        const size = encoder.encode(JSON.stringify(line)).length + (count > 0 ? 1 : 0);
        if (count > 0 && bytes + size > DEVICE_LOG_BYTES) break;
        bytes += size;
        count += 1;
      }
      const batch = { lines: waiting.slice(0, count), dropped };
      waiting = waiting.slice(count);
      dropped = 0;
      return batch;
    },

    putBack(batch) {
      waiting = [...batch.lines, ...waiting];
      dropped += batch.dropped;
    },

    lose(batch) {
      dropped += batch.lines.reduce((sum, line) => sum + line.count, batch.dropped);
    },

    get size() {
      return waiting.length;
    },
  };
}

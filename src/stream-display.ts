const SPINNER_FRAMES = ['\u28CB', '\u28D9', '\u28F9', '\u28F8', '\u28FC', '\u28F4', '\u28E6', '\u28E7', '\u28C7', '\u28CF'];

interface ParticipantStatus {
  id: string;
  state: 'waiting' | 'streaming' | 'done' | 'failed';
  bytesReceived: number;
  startTime: number;
  durationMs?: number;
  signal?: string;
}

export class StreamDisplay {
  private statuses: Map<string, ParticipantStatus> = new Map();
  private lineCount: number;
  private spinnerIdx = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private rendered = false;

  constructor(participantIds: string[]) {
    this.lineCount = participantIds.length;
    for (const id of participantIds) {
      this.statuses.set(id, {
        id,
        state: 'waiting',
        bytesReceived: 0,
        startTime: Date.now(),
      });
    }
  }

  start(): void {
    this.render();
    this.rendered = true;
    this.intervalId = setInterval(() => {
      this.spinnerIdx = (this.spinnerIdx + 1) % SPINNER_FRAMES.length;
      this.rerender();
    }, 80);
  }

  onData(participantId: string, chunk: string): void {
    const status = this.statuses.get(participantId);
    if (!status) return;
    status.state = 'streaming';
    status.bytesReceived += Buffer.byteLength(chunk);
  }

  onDone(participantId: string, signal?: string): void {
    const status = this.statuses.get(participantId);
    if (!status) return;
    status.state = 'done';
    status.durationMs = Date.now() - status.startTime;
    status.signal = signal;
  }

  onFailed(participantId: string): void {
    const status = this.statuses.get(participantId);
    if (!status) return;
    status.state = 'failed';
    status.durationMs = Date.now() - status.startTime;
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.rerender();
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  private formatTime(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  private formatLine(status: ParticipantStatus): string {
    const name = `[${status.id}]`.padEnd(10);
    const elapsed = Date.now() - status.startTime;

    switch (status.state) {
      case 'waiting':
        return `  ${name} ${SPINNER_FRAMES[this.spinnerIdx]} Waiting...`;
      case 'streaming':
        return `  ${name} ${SPINNER_FRAMES[this.spinnerIdx]} ${this.formatBytes(status.bytesReceived)} received (${this.formatTime(elapsed)})`;
      case 'done':
        return `  ${name} \u2713 Done${status.signal ? ` \u2014 ${status.signal}` : ''} (${this.formatTime(status.durationMs!)})`;
      case 'failed':
        return `  ${name} \u2717 Failed (${this.formatTime(status.durationMs!)})`;
    }
  }

  private render(): void {
    for (const status of this.statuses.values()) {
      process.stdout.write(this.formatLine(status) + '\n');
    }
  }

  private rerender(): void {
    if (!this.rendered) return;
    process.stdout.write(`\x1b[${this.lineCount}A`);
    for (const status of this.statuses.values()) {
      process.stdout.write('\x1b[2K' + this.formatLine(status) + '\n');
    }
  }
}

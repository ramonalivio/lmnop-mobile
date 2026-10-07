export type OtaUpdate = {
  shouldForceUpdate: boolean;
  updateBundle: () => Promise<boolean>;
};
export type OtaState = {
  phase:
    | 'checking'
    | 'idle'
    | 'prompt'
    | 'downloading'
    | 'restarting'
    | 'error';
  forced: boolean;
};

/** One update operation at a time, including foreground events from system UI. */
export class OtaController {
  private state: OtaState = { phase: 'checking', forced: false };
  private update: OtaUpdate | null = null;
  private busy = false;
  private downloaded = false;
  constructor(
    private checkUpdate: () => Promise<OtaUpdate | null>,
    private reload: () => Promise<void>,
    private changed: (state: OtaState) => void,
  ) {}
  private set(phase: OtaState['phase']) {
    this.state = { phase, forced: this.update?.shouldForceUpdate ?? false };
    this.changed(this.state);
  }
  async check(startup = false) {
    if (this.busy || this.update) return;
    this.busy = true;
    if (startup) this.set('checking');
    try {
      this.update = await this.checkUpdate();
      this.downloaded = false;
      this.set(this.update ? 'prompt' : 'idle');
    } catch {
      this.set('idle');
    } finally {
      this.busy = false;
    }
    if (startup && this.update) await this.download();
  }
  dismiss() {
    if (this.busy || this.update?.shouldForceUpdate) return;
    this.update = null;
    this.set('idle');
  }
  async download() {
    if (this.busy || !this.update) return;
    this.busy = true;
    try {
      if (!this.downloaded) {
        this.set('downloading');
        if (!(await this.update.updateBundle()))
          throw new Error('Download failed');
        this.downloaded = true;
      }
      this.set('restarting');
      await this.reload();
    } catch {
      this.set('error');
    } finally {
      this.busy = false;
    }
  }
}

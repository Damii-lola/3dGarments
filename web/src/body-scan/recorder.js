/**
 * Body scan video recorder.
 * Records the user standing + turning, extracts evenly-spaced key frames
 * (front / side / back as they rotate), returns them as Blobs for upload.
 */
export class BodyRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
    this.videoEl = null;
  }

  /** Request camera + start recording. Returns the <video> element to mount. */
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'environment' },
      audio: false,
    });
    const video = document.createElement('video');
    video.srcObject = this.stream;
    video.playsInline = true;
    video.muted = true;
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;background:#000;';
    video.autoplay = true;
    this.videoEl = video;

    await new Promise((r) => { video.onloadedmetadata = r; });

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 2_500_000,
    });
    this.chunks = [];
    this.mediaRecorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.mediaRecorder.start(1000); // 1 s slices
    return video;
  }

  /** Stop recording. Returns a Blob (webm). */
  stop() {
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' });
        this.stream.getTracks().forEach((t) => t.stop());
        if (this.videoEl) {
          this.videoEl.srcObject = null;
        }
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  /** Extract N evenly-spaced key frames from the recorded video as PNG Blobs. */
  static async extractFrames(blob, count = 6) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(blob);
      video.preload = 'metadata';
      video.onloadedmetadata = async () => {
        const duration = video.duration;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        const frames = [];

        for (let i = 0; i < count; i++) {
          const t = (duration / count) * (i + 0.5);
          await new Promise((r) => {
            video.onseeked = r;
            video.currentTime = t;
          });
          ctx.drawImage(video, 0, 0);
          frames.push(canvas.toDataURL('image/png'));
        }

        URL.revokeObjectURL(video.src);
        const blobs = frames.map((d) => {
          const b = atob(d.split(',')[1]);
          const ab = new ArrayBuffer(b.length);
          const u = new Uint8Array(ab);
          for (let i2 = 0; i2 < b.length; i2++) u[i2] = b.charCodeAt(i2);
          return new Blob([u], { type: 'image/png' });
        });
        resolve(blobs);
      };
      video.onerror = reject;
    });
  }
}

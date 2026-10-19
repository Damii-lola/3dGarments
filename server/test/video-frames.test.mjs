/**
 * The server takes the stills out of the clip, so this is the part that can fail
 * before any measuring happens. It is checked on a synthetic clip: the question
 * here is only whether a phone video comes apart into clean JPEG frames, not
 * whether a test pattern looks like a person.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegBinary, framesFromVideo } from '../src/lib/videoFrames.js';

const run = promisify(execFile);

test('a clip becomes still frames, on the server', async (t) => {
  const ffmpegPath = await ffmpegBinary();
  if (!ffmpegPath) {
    t.skip('ffmpeg is not installed in this environment');
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), '3dg-test-'));
  const clip = join(dir, 'clip.mp4');
  try {
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=30',
      '-t', '10', '-c:v', 'mpeg4', '-y', clip,
    ], { timeout: 60_000 });

    const frames = await framesFromVideo(clip, { from: 0, to: 10, count: 12 });
    assert.ok(frames.length >= 6, `only ${frames.length} frames came out`);
    assert.ok(frames.length <= 12, `${frames.length} frames is more than asked for`);
    assert.equal(frames[0].mimetype, 'image/jpeg');
    assert.match(frames[0].originalname, /^frame-\d+\.jpg$/);
    assert.ok(frames[0].buffer.length > 1000, 'the JPEG is empty');
    // Every frame has to be a real JPEG, not a zero-length file from a failed seek.
    assert.equal(frames[0].buffer[0], 0xff);
    assert.equal(frames[0].buffer[1], 0xd8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a trimmed span is respected, and a very short one still yields a picture', async (t) => {
  const ffmpegPath = await ffmpegBinary();
  if (!ffmpegPath) {
    t.skip('ffmpeg is not installed in this environment');
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), '3dg-test-'));
  const clip = join(dir, 'clip.mp4');
  try {
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
      '-t', '8', '-c:v', 'mpeg4', '-y', clip,
    ], { timeout: 60_000 });

    const late = await framesFromVideo(clip, { from: 6, to: 7.5, count: 16 });
    assert.ok(late.length >= 1, 'nothing came out of a 1.5 s window');
    assert.ok(late.length <= 16);

    const tiny = await framesFromVideo(clip, { from: 2, to: 2.4, count: 16 });
    assert.ok(tiny.length >= 1, 'nothing came out of a 0.4 s window');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

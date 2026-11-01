import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../crates/zephium-engine/src/platform/automatic_pip.js', import.meta.url), 'utf8');
function fixture() {
  const listeners = new Map();
  const doc = {
    defaultView: { innerWidth: 1200, innerHeight: 800 },
    pictureInPictureEnabled: true, pictureInPictureElement: null,
    querySelectorAll: selector => selector === 'video' ? [video] : [],
    async exitPictureInPicture() { this.pictureInPictureElement = null; listeners.get('leavepictureinpicture')?.(); },
  };
  const video = {
    ownerDocument: doc, paused: false, ended: false, readyState: 4,
    muted: false, volume: 1, videoWidth: 640, videoHeight: 360,
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 }),
    async requestPictureInPicture() { doc.pictureInPictureElement = video; },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
  };
  return { doc, video, run: runInNewContext(source, { document: doc }) };
}
test('switch back closes only automatically opened PiP', async () => {
  const { doc, video, run } = fixture();
  assert.equal(await run('leave', 1), true);
  assert.equal(doc.pictureInPictureElement, video);
  await run('return', 2);
  assert.equal(doc.pictureInPictureElement, null);
  doc.pictureInPictureElement = video;
  assert.equal(await run('leave', 3), false);
  await run('return', 4);
  assert.equal(doc.pictureInPictureElement, video);
});
test('return during native entry cancels the late presentation', async () => {
  const { doc, video, run } = fixture();
  let finish;
  video.requestPictureInPicture = () => new Promise(resolve => { finish = () => { doc.pictureInPictureElement = video; resolve(); }; });
  const entering = run('leave', 1);
  await run('return', 2);
  finish();
  assert.equal(await entering, false);
  assert.equal(doc.pictureInPictureElement, null);
  assert.equal(await run('leave', 1), false);
});
test('manual dismissal is respected until returning to the tab', async () => {
  const { doc, run } = fixture();
  await run('leave', 1);
  await doc.exitPictureInPicture();
  assert.equal(await run('leave', 2), false);
  await run('return', 3);
  assert.equal(await run('leave', 4), true);
});
test('rapid return and leave share a pending native entry', async () => {
  const { doc, video, run } = fixture();
  let finish;
  let calls = 0;
  video.requestPictureInPicture = () => new Promise(resolve => {
    calls++;
    finish = () => { doc.pictureInPictureElement = video; resolve(); };
  });
  const entering = run('leave', 1);
  await run('return', 2);
  await run('leave', 3);
  finish();
  assert.equal(await entering, true);
  assert.equal(calls, 1);
  assert.equal(doc.pictureInPictureElement, video);
  await run('return', 4);
  assert.equal(doc.pictureInPictureElement, null);
});
test('WebKit presentation uses the same ownership and return policy', async () => {
  const { doc, video, run } = fixture();
  doc.pictureInPictureEnabled = false;
  video.webkitPresentationMode = 'inline';
  video.webkitSupportsPresentationMode = mode => mode === 'picture-in-picture';
  video.webkitSetPresentationMode = mode => { video.webkitPresentationMode = mode; };
  assert.equal(await run('leave', 1), true);
  assert.equal(video.webkitPresentationMode, 'picture-in-picture');
  await run('return', 2);
  assert.equal(video.webkitPresentationMode, 'inline');
});
test('paused, muted, opted-out and fullscreen video never auto-opens', async () => {
  for (const key of ['paused', 'ended', 'muted', 'disablePictureInPicture']) {
    const { doc, video, run } = fixture();
    video[key] = true;
    assert.equal(await run('leave', 1), false, key);
    assert.equal(doc.pictureInPictureElement, null);
  }
  const { doc, run } = fixture();
  doc.fullscreenElement = {};
  assert.equal(await run('leave', 1), false);
});
test('native rejection leaves subsequent manual use available', async () => {
  const { doc, video, run } = fixture();
  video.requestPictureInPicture = async () => { throw new Error('policy denied'); };
  assert.equal(await run('leave', 1), false);
  doc.pictureInPictureElement = video;
  await run('return', 2);
  assert.equal(doc.pictureInPictureElement, video);
});

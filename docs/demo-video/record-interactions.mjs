// Real browser screencast helpers, invoked inside the authenticated Tabbit task.
// Product data is never fabricated. Overlays provide cursor, caption and privacy masks.
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

export async function overlays(page, caption = '') {
  await page.evaluate((text) => {
    document.getElementById('dsh-demo-overlays')?.remove();
    if (window.__dshDemoFrame) cancelAnimationFrame(window.__dshDemoFrame);
    const root = document.createElement('div');
    root.id = 'dsh-demo-overlays';
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const masks = document.createElement('div');
    root.appendChild(masks);
    const cursor = document.createElement('div');
    cursor.id = 'dsh-demo-cursor';
    cursor.textContent = '➤';
    cursor.style.cssText = 'position:absolute;left:310px;top:80px;font-size:28px;line-height:1;color:#111;transform:rotate(-30deg);text-shadow:0 0 2px white,0 0 4px white';
    root.appendChild(cursor);
    const subtitle = document.createElement('div');
    subtitle.id = 'dsh-demo-caption';
    subtitle.textContent = text;
    subtitle.style.cssText = 'position:absolute;bottom:12px;left:300px;right:20px;padding:12px 20px;border-radius:10px;background:#101827ed;color:white;font:600 22px system-ui;text-align:center';
    root.appendChild(subtitle);
    document.body.appendChild(root);
    if (window.__dshDemoMouse) document.removeEventListener('mousemove', window.__dshDemoMouse);
    window.__dshDemoMouse = e => { cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px`; };
    document.addEventListener('mousemove', window.__dshDemoMouse);
    const update = () => {
      masks.replaceChildren();
      const nodes = [...document.querySelectorAll('[role="tree"],button[aria-label="账号菜单"],button[aria-label="Account menu"]')];
      for (const node of document.querySelectorAll('input,textarea')) {
        if (/\/Users\/|\/home\//.test(node.value || '')) nodes.push(node);
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!root.contains(node) && /\/Users\/|\/home\//.test(node.textContent || '') && node.parentElement) nodes.push(node.parentElement);
      }
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
        const m = document.createElement('div');
        m.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;background:#e7eaf0;border-radius:4px`;
        masks.appendChild(m);
      }
      window.__dshDemoFrame = requestAnimationFrame(update);
    };
    update();
  }, caption);
}

export async function caption(page, text) {
  await page.evaluate(t => { document.getElementById('dsh-demo-caption').textContent = t; }, text);
}

export async function moveClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Recording target has no visible bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 15});
  await locator.click({timeout: 5000});
}

export async function record(context, page, directory, action) {
  const out = resolve(directory);
  await mkdir(out, {recursive: true});
  const cdp = await context.newCDPSession(page);
  const pending = [];
  const frames = [];
  const marks = [];
  const errors = [];
  const started = Date.now();
  const handler = event => {
    const index = frames.length;
    const filename = `frame-${String(index).padStart(5, '0')}.jpg`;
    frames.push({file: filename, milliseconds: Date.now() - started, timestamp: event.metadata.timestamp});
    pending.push(writeFile(join(out, filename), Buffer.from(event.data, 'base64'), {flag: 'wx'}).catch(e => errors.push(e)));
    pending.push(cdp.send('Page.screencastFrameAck', {sessionId: event.sessionId}).catch(e => errors.push(e)));
  };
  let actionError;
  await cdp.send('Page.enable');
  cdp.on('Page.screencastFrame', handler);
  try {
    await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 90, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1});
    await action(name => marks.push({name, milliseconds: Date.now() - started}));
    marks.push({name: 'capture-end', milliseconds: Date.now() - started});
  } catch (error) {
    actionError = error;
  } finally {
    try {
      await cdp.send('Page.stopScreencast');
    } catch (error) {
      errors.push(error);
    } finally {
      cdp.off('Page.screencastFrame', handler);
      await Promise.all(pending);
      await cdp.detach();
    }
  }
  if (actionError) throw actionError;
  if (errors.length) throw errors[0];
  if (frames.length < 2) throw new Error('Screencast did not capture moving frames');
  const metadata = {method: 'Chrome DevTools Page.startScreencast via Tabbit', startedAt: new Date(started).toISOString(), durationMilliseconds: marks.at(-1).milliseconds, viewport: await page.evaluate(() => [innerWidth, innerHeight]), marks, frames};
  await writeFile(join(out, 'capture.json'), JSON.stringify(metadata, null, 2) + '\n', {flag: 'wx'});
  return {directory: out, frames: frames.length, durationMilliseconds: metadata.durationMilliseconds};
}

export async function cleanup(page) {
  await page.evaluate(() => {
    cancelAnimationFrame(window.__dshDemoFrame);
    document.removeEventListener('mousemove', window.__dshDemoMouse);
    document.getElementById('dsh-demo-overlays')?.remove();
    delete window.__dshDemoFrame;
    delete window.__dshDemoMouse;
  });
}

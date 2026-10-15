(async () => {
  const item = document.querySelector('.taskItemSelected');
  const btn = item?.querySelector('.taskMoreBtn');
  if (!btn) return 'MISS';
  btn.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 200));
  const rect = btn.getBoundingClientRect();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const fire = (type, target) => {
    const down = /down|over|enter|move/.test(type) ? 1 : 0;
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
      button: 0, buttons: /(down)/.test(type) ? 1 : 0, isPrimary: true
    }));
    if (!type.startsWith('pointer')) {
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0, buttons: /(down)/.test(type) ? 1 : 0
      }));
    }
  };
  ['pointerover','pointermove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => fire(t, btn));
  await new Promise(r => setTimeout(r, 800));
  const hits = [...document.querySelectorAll('body *')]
    .filter(e => e.children.length <= 3)
    .map(e => ({ cls: e.className.toString().slice(0, 80), text: (e.innerText || '').trim() }))
    .filter(o => o.text && o.text.length < 40 && /重命名|删除|置顶|导出|复制|分享|归档/.test(o.text));
  const uniq = [...new Set(hits.map(h => JSON.stringify(h)))].map(JSON.parse);
  return JSON.stringify({ x: Math.round(x), y: Math.round(y), hits: uniq.slice(0, 20) });
})()

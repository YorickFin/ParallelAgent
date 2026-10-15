(() => {
  // 任务项上的 data-* / id 属性（找唯一标识）
  const first = document.querySelector('.taskItemWrapper');
  const attrs = {};
  if (first) {
    for (const a of first.attributes) attrs[a.name] = a.value.slice(0, 120);
  }
  const inner = first?.querySelector('.taskItem');
  const innerAttrs = {};
  if (inner) {
    for (const a of inner.attributes) innerAttrs[a.name] = a.value.slice(0, 120);
  }
  // 向上三层的属性
  const chain = [];
  let cur = first;
  for (let i = 0; i < 4 && cur; i++) {
    const o = { tag: cur.tagName.toLowerCase(), cls: cur.className.toString().slice(0, 80) };
    for (const a of cur.attributes) {
      if (a.name.startsWith('data-') || a.name === 'id') o[a.name] = a.value.slice(0, 120);
    }
    chain.push(o);
    cur = cur.parentElement;
  }
  // 已加载代码里出现过的 TaskState 类名（从现有图标归纳）
  const stateIcons = [...document.querySelectorAll('[class*="session-status-icon"]')].map(el => ({
    text: (el.closest('.taskItem')?.querySelector('.taskText')?.innerText || '').trim(),
    cls: el.className.toString().slice(0, 160),
    svgCls: (el.querySelector('svg')?.className.baseVal || '').slice(0, 120)
  }));
  return JSON.stringify({ wrapperAttrs: attrs, itemAttrs: innerAttrs, chain, stateIcons }, null, 1);
})()

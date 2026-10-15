(() => {
  const pick = (el) => el ? {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    cls: (el.className && el.className.toString().slice(0, 160)) || '',
    id: el.id || '',
    placeholder: el.getAttribute('placeholder') || '',
    ariaLabel: el.getAttribute('aria-label') || '',
    contentEditable: el.getAttribute('contenteditable'),
    text: (el.innerText || '').slice(0, 60)
  } : null;

  // 1) 输入类元素
  const inputs = [...document.querySelectorAll('textarea, [contenteditable=""], [contenteditable="true"], input[type="text"]')]
    .slice(0, 10).map(pick);

  // 2) role 分布统计
  const roleCount = {};
  document.querySelectorAll('[role]').forEach(e => {
    const r = e.getAttribute('role');
    roleCount[r] = (roleCount[r] || 0) + 1;
  });

  // 3) 找“新建任务”文本元素
  const kw = ['新建任务', '新任务'];
  const hits = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let n, guard = 0;
  while ((n = walker.nextNode()) && guard < 4000) {
    guard++;
    const t = (n.innerText || '').trim();
    if (t && t.length < 12 && kw.some(k => t.includes(k)) && n.children.length <= 2) {
      hits.push(pick(n));
      if (hits.length >= 5) break;
    }
  }

  // 4) 按钮总数 + 底部区域可见按钮
  const allBtns = [...document.querySelectorAll('button, [role="button"]')];
  const visibleBtns = allBtns.filter(b => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).slice(-15).map(pick);

  return JSON.stringify({
    url: location.href,
    inputCount: document.querySelectorAll('textarea,[contenteditable]').length,
    inputs,
    roleCount,
    newTaskHits: hits,
    totalButtons: allBtns.length,
    lastVisibleButtons: visibleBtns
  }, null, 1);
})()

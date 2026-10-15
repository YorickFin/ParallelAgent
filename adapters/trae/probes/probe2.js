(() => {
  // 1) 所有 class 含 task-list / task-item 的元素，统计 class
  const classStat = {};
  document.querySelectorAll('[class*="task"]').forEach(e => {
    (e.className.toString().split(/\s+/)).forEach(c => {
      if (/task/i.test(c)) classStat[c] = (classStat[c] || 0) + 1;
    });
  });

  // 2) 找任务项：class 含 task-list-item 或类似
  const cand = [
    ...document.querySelectorAll('[class*="task-list-item"]'),
    ...document.querySelectorAll('[class*="taskItem"]'),
    ...document.querySelectorAll('[class*="task-panel-item"]')
  ];
  const uniq = [...new Set(cand)];
  const items = uniq.slice(0, 30).map(el => ({
    cls: el.className.toString().slice(0, 200),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    text: (el.innerText || '').trim().slice(0, 40),
    rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()
  }));

  // 3) 发送按钮当前状态
  const send = document.querySelector('.chat-input-v2-send-button');
  const sendInfo = send ? {
    disabled: send.disabled || null,
    ariaDisabled: send.getAttribute('aria-disabled'),
    cls: send.className.toString(),
    html: send.outerHTML.slice(0, 300)
  } : null;

  // 4) 找激活态：class 含 active/selected/current 且在任务面板区域
  const active = [...document.querySelectorAll('[class*="active"],[class*="selected"],[aria-selected="true"]')]
    .filter(e => { const c = e.className.toString(); return /task/i.test(c); })
    .slice(0, 10).map(el => ({
      cls: el.className.toString().slice(0, 200),
      text: (el.innerText || '').trim().slice(0, 40),
      ariaSelected: el.getAttribute('aria-selected')
    }));

  return JSON.stringify({ classCount: Object.keys(classStat).length, classStat, itemCandidates: items.length, items, sendInfo, active }, null, 1);
})()

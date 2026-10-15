(() => {
  // 1) 发送按钮完整内部结构（找 send/stop 两套图标及显隐）
  const send = document.querySelector('.chat-input-v2-send-button');
  const icons = send ? [...send.querySelectorAll('span[data-testid], svg[class*="icon"]')].map(e => ({
    tag: e.tagName.toLowerCase(),
    testid: e.getAttribute('data-testid'),
    cls: (e.className.baseVal || e.className || '').toString().slice(0, 120),
    display: getComputedStyle(e).display,
    parent: e.parentElement.getAttribute('data-testid')
  })) : [];

  // 2) 任务状态图标：哪些任务带、长什么样
  const statusIcons = [...document.querySelectorAll('.taskStatusIcon')].map(el => {
    const item = el.closest('.taskItem');
    return {
      itemText: item ? (item.querySelector('.taskText')?.innerText || '').trim() : '',
      cls: el.className.toString().slice(0, 200),
      html: el.outerHTML.slice(0, 300),
      title: el.getAttribute('title') || el.getAttribute('aria-label') || ''
    };
  });

  // 3) 分组名 → 组内任务名（任务归属哪个项目）
  const groups = [...document.querySelectorAll('.task-list-group')].map(g => {
    const name = (g.querySelector('.task-list-group-name')?.innerText || '').trim();
    const tasks = [...g.querySelectorAll('.taskItem .taskText')].map(t => (t.innerText || '').trim());
    return { name, tasks };
  }).filter(g => g.tasks.length);

  // 4) 输入框父容器结构（找粘贴/输入法挂载点、占位提示）
  const box = document.querySelector('.chat-input-v2-input-box-editable');
  const boxInfo = box ? {
    parentCls: box.parentElement.className.toString().slice(0, 160),
    outerStart: box.outerHTML.slice(0, 200),
    spellcheck: box.getAttribute('spellcheck')
  } : null;

  // 5) 顶部当前任务标题元素（切换核对的另一处来源）
  const headers = [...document.querySelectorAll('[class*="taskHeader"], [class*="taskName"]')].slice(0, 5).map(el => ({
    cls: el.className.toString().slice(0, 120),
    text: (el.innerText || '').trim().slice(0, 60)
  }));

  return JSON.stringify({ icons, statusIcons, groups, boxInfo, headers }, null, 1);
})()

// 探查 IDE 当前会话列表与状态
(() => {
  const rows = document.querySelectorAll('.task-list-row-wrapper[data-session-id]');
  const out = [];
  rows.forEach(r => {
    const sid = r.getAttribute('data-session-id');
    const title = r.querySelector('.taskText')?.textContent?.trim() || '';
    const sel = r.querySelector('.taskItemSelected') ? true : false;
    const running = r.querySelector('.session-status-icon-progress, .trae-icon-TaskState_running') ? true : false;
    out.push({ sid: sid?.slice(0,8), title: title.slice(0,40), sel, running });
  });
  return JSON.stringify({ count: out.length, items: out.slice(0,20) }, null, 2);
})();

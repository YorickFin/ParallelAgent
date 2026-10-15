// 探查 IDE 当前选中会话的消息历史，找"探针B"
(() => {
  const out = {};
  // 当前选中任务标题
  const sel = document.querySelector('.taskItemSelected');
  out.currentTitle = sel?.closest('.task-list-row-wrapper')?.querySelector('.taskText')?.textContent?.trim() || '';
  // 当前选中 session id
  out.currentSid = sel?.closest('.task-list-row-wrapper')?.getAttribute('data-session-id') || '';
  // 列出所有用户消息气泡（包含"探针"的）
  const userMsgs = [];
  document.querySelectorAll('.chat-message-user, [class*="user-message"], [class*="UserMessage"]').forEach(el => {
    const t = el.textContent?.trim() || '';
    if (t.includes('探针')) userMsgs.push(t.slice(0, 80));
  });
  out.probeMsgs = userMsgs;
  // 兜底：搜任何含"探针B"的节点
  const all = document.body.innerText;
  const idx = all.indexOf('探针B');
  out.foundInText = idx >= 0 ? all.substring(Math.max(0,idx-20), idx+80) : null;
  return JSON.stringify(out, null, 2);
})();

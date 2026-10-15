// 探查 IDE 当前状态：弹窗、AI 思考、发送按钮
(() => {
  const out = {};
  // 删除/确认弹窗
  const dialogs = [];
  document.querySelectorAll('[class*="dialog"], [role="dialog"]').forEach(d => {
    const t = d.textContent?.trim() || '';
    if (t.length > 0 && t.length < 500) dialogs.push({ cls: d.className?.slice(0,80), text: t.slice(0,200) });
  });
  out.dialogs = dialogs;
  // 发送按钮状态（是否在跑）
  const sendBtn = document.querySelector('.chat-input-v2-send-button');
  if (sendBtn) {
    out.sendIcon = sendBtn.querySelector('[data-testid]')?.getAttribute('data-testid') || sendBtn.querySelector('svg')?.className?.baseVal || '';
  }
  // 思考中
  out.thinking = !!document.querySelector('[class*="thinking"], [class*="loading"]');
  // 当前消息列表中最后一条用户消息
  const userMsgs = document.querySelectorAll('[class*="chat-message-user"], [class*="user-message"], [class*="UserMessage"]');
  out.lastUserMsg = userMsgs[userMsgs.length-1]?.textContent?.trim()?.slice(0,100) || '';
  // 找 AI 思考内容
  const thinkEl = document.querySelector('[class*="thinking"], [class*="Thinking"]');
  out.thinkText = thinkEl?.textContent?.trim()?.slice(0,150) || '';
  return JSON.stringify(out, null, 2);
})();

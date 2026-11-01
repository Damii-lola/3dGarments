/**
 * FindMySize AI help chat — bottom-right floating button.
 * Calls /api/chat on the same server that already runs Cloudflare Workers AI.
 */
(function () {
  'use strict';

  var API = (window.FMS_API_URL || 'https://threedgarments.onrender.com').replace(/\/$/, '');

  var STYLE = [
    '.fms-chat-btn{position:fixed;right:1.1rem;bottom:1.1rem;z-index:2147482500;width:3.4rem;height:3.4rem;border:0;border-radius:50%;background:#f0521f;color:#fff;box-shadow:0 .6rem 1.6rem rgba(240,82,31,.35);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.4rem}',
    '.fms-chat-btn:hover{filter:brightness(1.08)}',
    '.fms-chat-panel{position:fixed;right:1.1rem;bottom:5.2rem;z-index:2147482500;width:min(22rem,calc(100vw - 2rem));height:min(28rem,70vh);display:none;flex-direction:column;border-radius:1rem;background:#1a1410;color:#f5e9d6;box-shadow:0 1.2rem 3rem rgba(0,0,0,.5);overflow:hidden;border:1px solid rgba(255,255,255,.08)}',
    '.fms-chat-panel.open{display:flex}',
    '.fms-chat-head{display:flex;align-items:center;justify-content:space-between;padding:.7rem .9rem;background:#221a15;font-weight:650;font-size:.92rem}',
    '.fms-chat-close{background:none;border:0;color:#f5e9d6;font-size:1.3rem;cursor:pointer;padding:.2rem .4rem}',
    '.fms-chat-msgs{flex:1;overflow-y:auto;padding:.8rem;display:flex;flex-direction:column;gap:.6rem;font-size:.88rem;line-height:1.4}',
    '.fms-chat-msg{max-width:85%;padding:.5rem .7rem;border-radius:.7rem}',
    '.fms-chat-msg.user{align-self:flex-end;background:#f0521f;color:#fff}',
    '.fms-chat-msg.bot{align-self:flex-start;background:#2a221c}',
    '.fms-chat-form{display:flex;gap:.4rem;padding:.6rem;border-top:1px solid rgba(255,255,255,.08)}',
    '.fms-chat-input{flex:1;border:0;border-radius:.5rem;padding:.5rem .7rem;background:#2a221c;color:#f5e9d6;font:inherit}',
    '.fms-chat-send{border:0;border-radius:.5rem;padding:.5rem .8rem;background:#f0521f;color:#fff;font-weight:650;cursor:pointer}',
  ].join('');

  var style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.className = 'fms-chat-btn';
  btn.setAttribute('aria-label', 'Ask AI');
  btn.innerHTML = '💬';
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.className = 'fms-chat-panel';
  panel.innerHTML = [
    '<div class="fms-chat-head"><span>Ask about FindMySize</span><button class="fms-chat-close" aria-label="Close">×</button></div>',
    '<div class="fms-chat-msgs"><div class="fms-chat-msg bot">Hi! Ask me how to use FindMySize, add a size chart, or get the embed code.</div></div>',
    '<form class="fms-chat-form"><input class="fms-chat-input" placeholder="Type a question…" /><button class="fms-chat-send" type="submit">Send</button></form>',
  ].join('');
  document.body.appendChild(panel);

  var msgs = panel.querySelector('.fms-chat-msgs');
  var form = panel.querySelector('.fms-chat-form');
  var input = panel.querySelector('.fms-chat-input');
  var closeBtn = panel.querySelector('.fms-chat-close');

  function addMsg(text, who) {
    var el = document.createElement('div');
    el.className = 'fms-chat-msg ' + who;
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  btn.addEventListener('click', function () {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) input.focus();
  });
  closeBtn.addEventListener('click', function () { panel.classList.remove('open'); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    input.value = '';
    addMsg(q, 'user');
    var thinking = document.createElement('div');
    thinking.className = 'fms-chat-msg bot';
    thinking.textContent = '…';
    msgs.appendChild(thinking);
    msgs.scrollTop = msgs.scrollHeight;
    try {
      var res = await fetch(API + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      var data = await res.json();
      thinking.textContent = data.reply || data.error || 'No reply.';
    } catch (err) {
      thinking.textContent = 'Could not reach the AI. Try again later.';
    }
  });
})();

import type { WebAuthPageData } from '../../core/webauth/WebAuthService.js';
import { evaluateBrowserUserAgent } from '../../core/webauth/browserGate.js';
import type { BrowserGateResult } from '../../core/webauth/types.js';

/** HTML-escapes untrusted Discord names before they are interpolated. */
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    } as Record<string, string>)[character] || character);
}

/** Safe inline JSON: `</script>` cannot terminate the script element. */
export function jsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

const PAGE_STYLE = `
:root{
color-scheme:light;
--bg:#faf9f6;--surface:#ffffff;--surface-soft:#f7f5f1;
--border:rgba(58,48,33,.10);--border-strong:rgba(58,48,33,.18);
--ink:#302e2b;--ink-soft:#69655f;--ink-muted:#79736c;
--accent:#59534b;--accent-strong:#39352f;--accent-soft:#ede9e2;--on-accent:#ffffff;
--success:#127a5a;--warn:#c07b15;--danger:#c43d42;
--success-bg:#eff7f3;--success-border:#cfe8dc;--success-ink:#0f5f46;
--warn-bg:#fdf6e8;--warn-border:#efe0bf;--warn-ink:#8a5a11;
--danger-bg:#fdf2f2;--danger-border:#f0cdce;--danger-ink:#a83237;
--shadow-md:0 4px 16px rgba(20,30,50,.05);
--radius-lg:16px;--radius-md:12px;
}
@media (prefers-color-scheme:dark){
:root{
color-scheme:dark;
--bg:#1b1a18;--surface:#27241f;--surface-soft:#302d27;
--border:rgba(148,163,184,.16);--border-strong:rgba(148,163,184,.28);
--ink:#f4f0e9;--ink-soft:#c2bcb2;--ink-muted:#a29a8e;
--accent:#ddd3c3;--accent-strong:#e7dece;--accent-soft:rgba(221,211,195,.12);--on-accent:#28231c;
--success:#4bc694;--warn:#e3a64a;--danger:#ef6b73;
--success-bg:#1b2a24;--success-border:#2c4b3f;--success-ink:#8fd9bb;
--warn-bg:#2f2819;--warn-border:#524426;--warn-ink:#e8c07d;
--danger-bg:#33211f;--danger-border:#5a2f2f;--danger-ink:#f0a5a8;
--shadow-md:0 14px 32px rgba(0,0,0,.32);
}
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;
background:var(--bg);color:var(--ink);
font-family:'IBM Plex Sans JP','IBM Plex Sans',system-ui,-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;
font-size:16px;line-height:1.6;padding:24px;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:560px;background:var(--surface);border:1px solid var(--border);
border-radius:var(--radius-lg);padding:32px;box-shadow:var(--shadow-md);overflow-wrap:anywhere}
.eyebrow{font-size:11px;letter-spacing:.16em;color:var(--ink-muted);font-weight:700;text-transform:uppercase}
h1{margin:6px 0 4px;font-size:26px;line-height:1.3;font-weight:700;letter-spacing:-.01em}
.sub{margin:0;color:var(--ink-soft);font-size:14px}
.target{margin:20px 0;padding:6px 16px;border-radius:var(--radius-md);background:var(--surface-soft);border:1px solid var(--border)}
.target div{display:flex;justify-content:space-between;gap:12px;padding:9px 0;font-size:14px;border-bottom:1px solid var(--border)}
.target div:last-child{border-bottom:0}
.target span:first-child{color:var(--ink-soft);flex:none}
.target span:last-child{font-weight:600;text-align:right;word-break:break-word}
.status{margin:16px 0;padding:12px 14px;border-radius:var(--radius-md);font-size:14px;line-height:1.6;
background:var(--surface-soft);border:1px solid var(--border);color:var(--ink-soft)}
.status.bad{background:var(--danger-bg);border-color:var(--danger-border);color:var(--danger-ink)}
.status.warn{background:var(--warn-bg);border-color:var(--warn-border);color:var(--warn-ink)}
.status.ok{background:var(--success-bg);border-color:var(--success-border);color:var(--success-ink)}
button{width:100%;margin-top:20px;padding:15px 20px;border-radius:var(--radius-md);border:1px solid transparent;
font-family:inherit;font-size:16px;font-weight:700;color:var(--on-accent);background:var(--accent);cursor:pointer;
min-height:52px;touch-action:manipulation;
transition:background .18s ease,border-color .18s ease,color .18s ease,opacity .18s ease}
button:hover:not(:disabled){background:var(--accent-strong)}
button:disabled{background:var(--surface-soft);border-color:var(--border);color:var(--ink-muted);opacity:.7;cursor:not-allowed}
button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.note{margin-top:16px;font-size:12px;line-height:1.7;color:var(--ink-muted)}
.challenge{margin:18px 0 0;padding:14px;border-radius:var(--radius-md);background:var(--surface-soft);border:1px solid var(--border)}
.challenge-head{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;
letter-spacing:.08em;color:var(--ink-soft);font-weight:700}
.challenge-instruction{margin:10px 0;font-size:15px;font-weight:700;line-height:1.5;color:var(--ink)}
.challenge-note{margin:8px 0 0;font-size:12px;line-height:1.6;color:var(--ink-muted)}
.field{position:relative;width:100%;aspect-ratio:320/220;border-radius:var(--radius-md);overflow:hidden;
background-color:var(--surface);
background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);
background-size:25% 33.333%;border:1px dashed var(--border-strong);touch-action:none;
user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.field.disabled{opacity:.5}
.field.passed{border-color:var(--success-border);background-color:var(--success-bg)}
.ch-item{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:10px;
background:var(--surface);border:1px solid var(--border-strong);color:var(--ink);font-size:18px;line-height:1;
cursor:grab;touch-action:none;transform:translate(-50%,-50%);will-change:left,top;
box-shadow:0 1px 3px rgba(20,30,50,.06)}
.ch-item:hover{background:var(--accent-soft)}
.ch-item.dragging{cursor:grabbing;background:var(--accent-soft);border-color:var(--accent);box-shadow:var(--shadow-md)}
.ch-target{position:absolute;transform:translate(-50%,-50%);border-radius:12px;border:2px dashed var(--accent);
background:var(--accent-soft);display:flex;align-items:center;justify-content:center;
color:var(--ink-soft);font-size:11px;font-weight:700;pointer-events:none}
.challenge.done .challenge-instruction{color:var(--success-ink)}
a{color:var(--accent);text-underline-offset:2px}
@media (max-width:420px){
body{padding:10px}
.card{padding:14px}
.challenge{padding:8px}
h1{font-size:22px}
button{padding:14px 16px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const FONT_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet">
`;

function shell(body: string, script: string, nonce: string): string {
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex,nofollow">
<title>Web認証</title>
${FONT_LINKS}
<style nonce="${escapeHtml(nonce)}">${PAGE_STYLE}</style>
</head>
<body>
<main class="card">
<div class="eyebrow">WEB AUTHENTICATION</div>
<h1>Web認証</h1>
${body}
</main>
${script ? `<script nonce="${escapeHtml(nonce)}">${script}</script>` : ''}
</body>
</html>`;
}

export function browserRequirementMessage(browser: BrowserGateResult): string {
    switch (browser.reason) {
        case 'ok': return '';
        case 'firefox': return 'Firefox は非対応です。Google Chrome・Microsoft Edge・Safari で開いてください。';
        case 'safari': return 'このSafariでは認証できません。最新のSafari、Google Chrome、Microsoft Edge で開いてください。';
        case 'ios-chrome': return 'このアプリ内ブラウザは非対応です。Safari で開いてください。';
        case 'in-app-webview': return 'アプリ内ブラウザは非対応です。Safari、Google Chrome、Microsoft Edge で開いてください。';
        case 'headless': return '自動化ブラウザでは認証できません。Google Chrome・Microsoft Edge・Safari で開いてください。';
        case 'missing-user-agent': return 'ブラウザ情報を取得できません。Google Chrome・Microsoft Edge・Safari で開いてください。';
        case 'unsupported-webkit': return 'このブラウザは非対応です。Safari、Google Chrome、Microsoft Edge で開いてください。';
        case 'brand-mismatch': return 'ブラウザ情報が一致しません。Google Chrome・Microsoft Edge・Safari で開いてください。';
        default: return 'Google Chrome・Microsoft Edge・Safari のみ認証できます。';
    }
}

const ERROR_TITLES: Record<string, string> = {
    invalid: '認証リンクが無効です',
    expired: '認証リンクの期限が切れました',
    'in-use': '認証を処理中です',
    error: '認証を開始できませんでした'
};

export function renderWebAuthErrorPage(
    status: string,
    message: string | null,
    nonce: string
): string {
    const title = ERROR_TITLES[status] || '認証できません';
    const detail = message || (
        status === 'expired'
            ? 'リンクの有効期限は10分です。Discordのパネルから「Web認証」を押して新しいリンクを発行してください。'
            : status === 'in-use'
                ? 'このリンクは現在処理中です。少し待ってからページを再読み込みしてください。'
                : 'リンクが使用済みか、発行元のサーバーと一致しません。Discordのパネルから新しいリンクを発行してください。'
    );
    return shell(`
<p class="sub">このページは一度だけ使用できます。</p>
<div class="status bad" role="alert">${escapeHtml(title)}</div>
<p class="note">${escapeHtml(detail)}</p>
`, '', nonce);
}

export function renderWebAuthSuccessPage(roleGranted: boolean, nonce: string): string {
    return shell(`
<div class="status ok" role="status">
認証が完了しました。このページは閉じて構いません。
</div>
<p class="note">${roleGranted
            ? '認証ロールを付与しました。Discordに戻って確認してください。'
            : '認証は記録されましたが、ロールの付与に失敗しました。スタッフにお問い合わせください。'}</p>
`, '', nonce);
}

/** Inline-SVG-free tiles: a glyph on a styled square, no external assets. */
function renderChallengeBlock(data: WebAuthPageData, disabled: boolean): string {
    if (data.challengePassed) {
        return `<div class="challenge done" id="ch-challenge">
<div class="challenge-head"><span>操作チェック</span><span id="ch-attempts">完了</span></div>
<div class="challenge-instruction" id="ch-instruction">操作チェックは完了しています。</div>
<p class="challenge-note" id="ch-note">「認証する」を押すと認証を実行します。</p>
</div>`;
    }
    if (!data.challenge) {
        return `<div class="challenge" id="ch-challenge">
<div class="challenge-head"><span>操作チェック</span><span id="ch-attempts">開始できません</span></div>
<div class="challenge-instruction" id="ch-instruction">操作チェックを開始できませんでした。</div>
<p class="challenge-note" id="ch-note">ページを再読み込みしてください。</p>
</div>`;
    }
    // Tiles are positioned with the CSSOM from the embedded challenge JSON:
    // the page CSP (style-src with a nonce) blocks inline style attributes.
    return `<div class="challenge" id="ch-challenge">
<div class="challenge-head"><span>操作チェック</span><span id="ch-attempts">残り ${escapeHtml(data.attemptsLeft)} 回</span></div>
<div class="challenge-instruction" id="ch-instruction">${escapeHtml(data.challenge.instruction)}</div>
<div class="field${disabled ? ' disabled' : ''}" id="ch-field" role="group" aria-label="操作チェックのフィールド"></div>
<p class="challenge-note" id="ch-note">マウスまたは指で、指示された図形をゴール枠へドラッグしてください。判定できない場合は配置が変わります。</p>
</div>`;
}

export function renderWebAuthPage(data: WebAuthPageData, nonce: string): string {
    if (data.status !== 'ready') {
        return renderWebAuthErrorPage(data.status, data.message, nonce);
    }

    const browserMessage = browserRequirementMessage(data.browser);
    const vpnBlocked = data.vpnBlocked;
    const blocked = !data.browser.allowed || vpnBlocked;
    const initialStatus = vpnBlocked
        ? 'VPN・プロキシ経由では認証できません。VPNを切断してから再読み込みしてください。'
        : !data.browser.allowed
            ? browserMessage
            : data.challengePassed
                ? '操作チェックは完了しています。「認証する」を押してください。'
                : '指示された図形をゴール枠へドラッグすると「認証する」が押せるようになります。';
    const statusClass = blocked ? 'bad' : '';

    const serverState = {
        token: data.token,
        browserOk: data.browser.allowed,
        vpnBlocked,
        intelUnavailable: data.intel?.verdict === 'unavailable',
        challengePassed: data.challengePassed,
        attemptsLeft: data.attemptsLeft,
        challenge: data.challenge,
        submitUrl: `/api/webauth/${encodeURIComponent(data.token)}/submit`,
        challengeUrl: `/api/webauth/${encodeURIComponent(data.token)}/challenge`
    };

    const script = `
(function(){
"use strict";
var S=${jsonForScript(serverState)};
/* Shared with the server gate (single source of truth). */
var browserGate=(${evaluateBrowserUserAgent.toString()});
var browserMessage=(${browserRequirementMessage.toString()});
var btn=document.getElementById('auth-button');
var status=document.getElementById('auth-status');
var chBox=document.getElementById('ch-challenge');
var field=document.getElementById('ch-field');
var instr=document.getElementById('ch-instruction');
var chNote=document.getElementById('ch-note');
var attemptsEl=document.getElementById('ch-attempts');
var blocked=!S.browserOk||S.vpnBlocked;
var clientOk=true;
var passed=!!S.challengePassed;
var ch=S.challenge||null;

function setStatus(text,kind){status.textContent=text;status.className='status'+(kind?' '+kind:'');}
function setNote(text){if(chNote)chNote.textContent=text;}
function setAttempts(n){
  if(!attemptsEl)return;
  attemptsEl.textContent=n>0?('残り '+n+' 回'):'再試行不可';
}
function refreshButton(){
  if(blocked||!clientOk){btn.disabled=true;btn.textContent='認証できません';return;}
  if(!passed){btn.disabled=true;btn.textContent='認証する';return;}
  btn.disabled=false;btn.textContent='認証する';
}

function brandsNow(){
  try{ if(navigator.userAgentData&&Array.isArray(navigator.userAgentData.brands)) return navigator.userAgentData.brands.map(function(b){return {brand:b.brand,version:b.version};}); }catch(e){}
  return null;
}
function clientBrowserCheck(){
  try{
    var result=browserGate(navigator.userAgent||'',brandsNow()||[]);
    if(result&&result.allowed)return {ok:true};
    return {ok:false,reason:browserMessage(result||{reason:'unsupported-chromium'})||'Google Chrome・Microsoft Edge・Safari で開いてください。'};
  }catch(e){
    /* A client-side failure must not block a browser the server may accept. */
    return {ok:true};
  }
}

function sha256Hex(buffer){
  return crypto.subtle.digest('SHA-256',buffer).then(function(digest){
    return Array.prototype.map.call(new Uint8Array(digest),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
  });
}
function fnv1a(text){
  var h=0x811c9dc5;
  for(var i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
  return ('00000000'+h.toString(16)).slice(-8);
}
function canvasHash(){
  try{
    var c=document.createElement('canvas');c.width=240;c.height=60;
    var ctx=c.getContext('2d');if(!ctx)return Promise.resolve('');
    var g=ctx.createLinearGradient(0,0,240,60);g.addColorStop(0,'#f60');g.addColorStop(1,'#08f');
    ctx.fillStyle=g;ctx.fillRect(0,0,240,60);ctx.font='16px sans-serif';ctx.fillStyle='#111';
    ctx.fillText('WebAuth fingerprint 認証',5,35);
    ctx.strokeStyle='rgba(255,255,255,.6)';ctx.beginPath();ctx.arc(190,30,18,0,Math.PI*2);ctx.stroke();
    var data=c.toDataURL();
    // crypto.subtle is unavailable on plain HTTP; fall back to a small JS hash.
    if(window.crypto&&window.crypto.subtle&&window.crypto.subtle.digest){
      return sha256Hex(new TextEncoder().encode(data)).catch(function(){return fnv1a(data);});
    }
    return Promise.resolve(fnv1a(data));
  }catch(e){return Promise.resolve('');}
}
function webglInfo(){
  try{
    var c=document.createElement('canvas');
    var gl=c.getContext('webgl')||c.getContext('experimental-webgl');
    if(!gl)return {vendor:'',renderer:''};
    var ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor:ext?String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)||''):'',
      renderer:ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)||''):''
    };
  }catch(e){return {vendor:'',renderer:''};}
}
function uaCh(){
  try{
    if(!navigator.userAgentData)return Promise.resolve({brands:brandsNow()||[],mobile:false});
    if(typeof navigator.userAgentData.getHighEntropyValues!=='function')return Promise.resolve({brands:brandsNow()||[],mobile:!!navigator.userAgentData.mobile});
    return navigator.userAgentData.getHighEntropyValues(['platform','platformVersion','model','mobile']).then(function(v){
      return {brands:brandsNow()||[],platform:v.platform,platformVersion:v.platformVersion,model:v.model,mobile:v.mobile};
    }).catch(function(){return {brands:brandsNow()||[],mobile:false};});
  }catch(e){return Promise.resolve({brands:[],mobile:false});}
}
function safeNumber(value){
  var n=Number(value);
  return isFinite(n)?n:0;
}
function collect(){
  var gl=webglInfo();
  return Promise.all([canvasHash(),uaCh()]).then(function(res){
    var touch={maxTouchPoints:0,touchEvent:false};
    var scr={width:0,height:0,colorDepth:0,pixelDepth:0};
    var tz='',langs=[],cores=0,mem=0;
    /* Every group is optional: Safari exposes no UA-CH, may omit
       deviceMemory and can restrict WebGL. A missing group is simply
       absent, never a submit blocker. */
    try{touch={maxTouchPoints:safeNumber(navigator.maxTouchPoints),touchEvent:('ontouchstart' in window)};}catch(e){}
    try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
    try{scr={width:safeNumber(screen.width),height:safeNumber(screen.height),colorDepth:safeNumber(screen.colorDepth),pixelDepth:safeNumber(screen.pixelDepth)};}catch(e){}
    try{langs=Array.isArray(navigator.languages)?navigator.languages.slice(0,20):[];}catch(e){}
    try{cores=safeNumber(navigator.hardwareConcurrency);}catch(e){}
    try{mem=safeNumber(navigator.deviceMemory);}catch(e){}
    return {
      userAgent:String(navigator.userAgent||''),
      uaCh:res[1]||{brands:[],mobile:false},
      screen:scr,
      timezone:tz,
      languages:langs,
      hardwareConcurrency:cores,
      deviceMemory:mem,
      canvasHash:(res&&res[0])||'',
      webglVendor:(gl&&gl.vendor)||'',
      webglRenderer:(gl&&gl.renderer)||'',
      touch:touch
    };
  }).catch(function(){
    return {
      userAgent:String(navigator.userAgent||''),
      uaCh:{brands:[],mobile:false},
      screen:{width:0,height:0,colorDepth:0,pixelDepth:0},
      timezone:'',languages:[],hardwareConcurrency:0,deviceMemory:0,
      canvasHash:'',webglVendor:'',webglRenderer:'',
      touch:{maxTouchPoints:0,touchEvent:false}
    };
  });
}

/* ---- drag check ---- */
function pct(value,total){return (value/total*100)+'%';}
function renderChallenge(){
  if(!field||!ch||passed)return;
  var W=ch.field.width,H=ch.field.height;
  while(field.firstChild)field.removeChild(field.firstChild);
  var target=document.createElement('div');
  target.className='ch-target';
  target.style.left=pct(ch.target.x,W);target.style.top=pct(ch.target.y,H);
  target.style.width=pct(ch.target.size,W);target.style.aspectRatio='1 / 1';
  target.textContent=ch.target.label;
  field.appendChild(target);
  for(var i=0;i<ch.items.length;i++){
    var item=ch.items[i];
    var el=document.createElement('div');
    el.className='ch-item';
    el.dataset.itemId=item.id;
    el.setAttribute('aria-label',item.label);
    el.title=item.label;
    el.textContent=item.symbol;
    el.style.left=pct(item.x,W);el.style.top=pct(item.y,H);
    el.style.width=pct(item.size,W);el.style.aspectRatio='1 / 1';
    field.appendChild(el);
  }
  if(instr)instr.textContent=ch.instruction;
}
function logical(evt){
  var rect=field.getBoundingClientRect();
  return {
    x:(evt.clientX-rect.left)/rect.width*ch.field.width,
    y:(evt.clientY-rect.top)/rect.height*ch.field.height
  };
}
function moveItem(el,point){
  var item=null;
  for(var i=0;i<ch.items.length;i++){if(ch.items[i].id===el.dataset.itemId)item=ch.items[i];}
  var half=item?item.size/2:22;
  var x=Math.min(Math.max(point.x,half),ch.field.width-half);
  var y=Math.min(Math.max(point.y,half),ch.field.height-half);
  el.style.left=pct(x,ch.field.width);
  el.style.top=pct(y,ch.field.height);
}
function resetItem(el){
  if(!ch)return;
  for(var i=0;i<ch.items.length;i++){
    if(ch.items[i].id===el.dataset.itemId){
      el.style.left=pct(ch.items[i].x,ch.field.width);
      el.style.top=pct(ch.items[i].y,ch.field.height);
      return;
    }
  }
}
function markPassed(){
  passed=true;S.challengePassed=true;
  if(chBox)chBox.classList.add('done');
  if(instr)instr.textContent='操作チェックは完了しています。';
  if(field)field.style.display='none';
  if(attemptsEl)attemptsEl.textContent='完了';
  setNote('「認証する」を押すと認証を実行します。');
  setStatus('操作チェック完了。認証するボタンが有効になりました。','ok');
  refreshButton();
}
function submitAttempt(itemId,drop,samples,pointerType,el){
  setStatus('操作を確認しています…','');
  fetch(S.challengeUrl,{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({itemId:itemId,drop:{x:drop.x,y:drop.y},samples:samples,pointerType:pointerType})
  }).then(function(response){
    return response.json().catch(function(){return {};}).then(function(body){return {status:response.status,body:body};});
  }).then(function(result){
    var body=result.body||{};
    if(result.status===200&&body.ok){markPassed();return;}
    el.classList.remove('dragging');
    resetItem(el);
    if(body.status==='locked'||body.status==='invalid'||body.status==='expired'||result.status===404||result.status===410){
      setStatus(body.error||'試行回数が上限に達しました。認証リンクは無効になりました。','bad');
      if(field)field.classList.add('disabled');
      window.setTimeout(function(){window.location.replace('/webauth/'+encodeURIComponent(S.token));},1800);
      return;
    }
    if(result.status===429){
      setStatus(body.error||'試行回数が多すぎます。少し待ってから再試行してください。','warn');
      return;
    }
    if(body.challenge){ch=body.challenge;S.challenge=ch;renderChallenge();}
    if(typeof body.attemptsLeft==='number'){S.attemptsLeft=body.attemptsLeft;setAttempts(body.attemptsLeft);}
    setStatus(body.error||'操作を確認できませんでした。もう一度お試しください。','bad');
    setNote('配置が変わっています。指示された図形をゴール枠へドラッグしてください。');
  }).catch(function(){
    setStatus('通信に失敗しました。ページを再読み込みします…','bad');
    window.setTimeout(function(){window.location.reload();},1500);
  });
}
if(ch&&!passed)renderChallenge();
if(field&&!blocked&&!passed){
  field.addEventListener('pointerdown',function(evt){
    if(passed||!ch)return;
    if(!evt.isPrimary)return;
    if(evt.pointerType==='mouse'&&evt.button!==0)return;
    var node=evt.target;
    var el=node&&node.closest?node.closest('.ch-item'):null;
    if(!el||!field.contains(el))return;
    evt.preventDefault();
    var itemId=el.dataset.itemId;
    var pointerType=evt.pointerType||'mouse';
    var t0=null,lastT=-1,samples=[],lastPoint=logical(evt);
    function sample(point){
      var now=performance.now();
      if(t0===null)t0=now;
      var t=now-t0;
      /* Touch events are already sparse on iOS; never drop one. */
      if(samples.length&&t-lastT<(pointerType==='touch'?0:12))return;
      samples.push({t:Math.round(t),x:Math.round(point.x*10)/10,y:Math.round(point.y*10)/10});
      lastT=t;
    }
    sample(lastPoint);
    var grabX=0,grabY=0;
    for(var gi=0;gi<ch.items.length;gi++){
      if(ch.items[gi].id===itemId){grabX=ch.items[gi].x-lastPoint.x;grabY=ch.items[gi].y-lastPoint.y;}
    }
    el.classList.add('dragging');
    moveItem(el,{x:lastPoint.x+grabX,y:lastPoint.y+grabY});
    function move(evt2){
      evt2.preventDefault();
      var point=logical(evt2);
      lastPoint=point;
      sample(point);
      moveItem(el,{x:point.x+grabX,y:point.y+grabY});
    }
    function finish(evt2){
      evt2.preventDefault();
      detach();
      var point=logical(evt2);
      lastPoint=point;
      var now=performance.now();
      if(t0===null)t0=now;
      var t=now-t0;
      if(t<lastT)t=lastT;
      samples.push({t:Math.round(t),x:Math.round(point.x*10)/10,y:Math.round(point.y*10)/10});
      el.classList.remove('dragging');
      submitAttempt(itemId,point,samples,pointerType,el);
    }
    function cancel(){
      detach();
      el.classList.remove('dragging');
      resetItem(el);
      setStatus('ドラッグが中断されました。もう一度お試しください。','');
    }
    function detach(){
      el.removeEventListener('pointermove',move);
      el.removeEventListener('pointerup',finish);
      el.removeEventListener('pointercancel',cancel);
      try{el.releasePointerCapture(evt.pointerId);}catch(e){}
    }
    el.addEventListener('pointermove',move);
    el.addEventListener('pointerup',finish);
    el.addEventListener('pointercancel',cancel);
    try{el.setPointerCapture(evt.pointerId);}catch(e){}
  });
}

var check=clientBrowserCheck();
if(!check.ok){clientOk=false;btn.disabled=true;btn.textContent='認証できません';setStatus(check.reason,'bad');}
else if(S.vpnBlocked){btn.disabled=true;btn.textContent='認証できません';setStatus('VPN・プロキシ経由では認証できません。VPNを切断してから再読み込みしてください。','bad');}
else{refreshButton();}
if(blocked&&field)field.classList.add('disabled');
if(S.intelUnavailable&&!S.vpnBlocked&&!passed){setStatus('IP評価を取得できませんでした。認証は可能ですが「未検証」として記録されます。','warn');}

btn.addEventListener('click',function(){
  if(btn.disabled)return;
  if(!passed){setStatus('先に操作チェックを完了してください。','bad');return;}
  btn.disabled=true;btn.textContent='認証中…';
  setStatus('端末情報を収集しています…','');
  collect().then(function(signals){
    return fetch(S.submitUrl,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({signals:signals})});
  }).then(function(response){
    return response.json().catch(function(){return {};}).then(function(body){
      if(response.ok&&body&&body.ok){window.location.replace('/webauth/success'+(body.roleGranted?'':'?roles=0'));return;}
      var message=(body&&body.error)||'認証に失敗しました。もう一度お試しください。';
      setStatus(message,'bad');btn.disabled=false;btn.textContent='もう一度試す';
    });
  }).catch(function(){
    setStatus('通信に失敗しました。接続を確認してもう一度お試しください。','bad');
    btn.disabled=false;btn.textContent='もう一度試す';
  });
});
})();
`;

    return shell(`
<p class="sub">このページは一度だけ使用できます（有効期限10分）。</p>
<div class="target">
<div><span>サーバー</span><span>${escapeHtml(data.guildName)}</span></div>
<div><span>認証するユーザー</span><span>${escapeHtml(data.userName)}</span></div>
</div>
<div id="auth-status" class="status ${statusClass}" role="status">${escapeHtml(initialStatus)}</div>
${renderChallengeBlock(data, blocked)}
<button id="auth-button" type="button"${blocked || !data.challengePassed ? ' disabled' : ''}>認証する</button>
<p class="note">
取得したIPアドレスとブラウザ・端末の指紋は、HMACハッシュと暗号化（AES-256-GCM）で保存されます。
同一IP・同一端末のアカウント検出と不正対策の目的にのみ使用し、生の値がWeb APIから返ることはありません。
</p>
`, script, nonce);
}

import type { WebAuthPageData } from '../../core/webauth/WebAuthService.js';
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
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:radial-gradient(1200px 600px at 50% -10%,#1e2545,#0b0d16 60%);color:#e8ecf8;
font-family:system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;padding:24px}
.card{width:min(560px,100%);background:rgba(19,23,38,.92);border:1px solid #2b3352;border-radius:20px;
padding:32px;box-shadow:0 24px 80px rgba(0,0,0,.45)}
.eyebrow{font-size:12px;letter-spacing:.14em;color:#8b9bd6;font-weight:700}
h1{margin:8px 0 4px;font-size:26px}
.sub{margin:0;color:#a6b0d0;font-size:14px}
.target{margin:22px 0;padding:16px;border-radius:14px;background:#111528;border:1px solid #262e4c}
.target div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:14px}
.target span:first-child{color:#8f9ac0}
.target span:last-child{font-weight:600;text-align:right;word-break:break-all}
.status{margin:16px 0;padding:12px 14px;border-radius:12px;font-size:14px;line-height:1.55;
background:#172038;border:1px solid #2a3866;color:#c9d3f5}
.status.bad{background:#2a1420;border-color:#6b2540;color:#ffc4d5}
.status.warn{background:#2a2210;border-color:#6b5520;color:#ffe1a3}
.status.ok{background:#0f2a1c;border-color:#1f6b45;color:#b9f5d3}
.features{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0;font-size:12px;color:#95a2c9}
.features span{padding:4px 9px;border-radius:999px;background:#151b2e;border:1px solid #293255}
button{width:100%;margin-top:20px;padding:15px 20px;border-radius:14px;border:0;font-size:16px;font-weight:700;
color:#fff;background:linear-gradient(180deg,#5669f5,#4353d8);cursor:pointer}
button:disabled{background:#2a3050;color:#7d88ab;cursor:not-allowed}
button:focus-visible{outline:2px solid #93a4ff;outline-offset:2px}
.note{margin-top:16px;font-size:12px;line-height:1.6;color:#8590b4}
a{color:#9db0ff}
`;

function shell(body: string, script: string, nonce: string): string {
    return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Web認証</title>
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
        case 'firefox': return 'Firefox は非対応です。Google Chrome または Microsoft Edge で開いてください。';
        case 'safari': return 'Safari は非対応です。Google Chrome または Microsoft Edge で開いてください。';
        case 'ios-chrome': return 'iOS版のブラウザは非対応です。パソコンの Google Chrome または Microsoft Edge で開いてください。';
        case 'in-app-webview': return 'アプリ内ブラウザは非対応です。Google Chrome または Microsoft Edge で開いてください。';
        case 'headless': return '自動化ブラウザでは認証できません。Google Chrome または Microsoft Edge で開いてください。';
        case 'missing-user-agent': return 'ブラウザ情報を取得できません。Google Chrome または Microsoft Edge で開いてください。';
        case 'brand-mismatch': return 'ブラウザ情報が一致しません。Google Chrome または Microsoft Edge で開いてください。';
        default: return 'Google Chrome または Microsoft Edge のみ認証できます。';
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
            : '「認証する」を押すと、ブラウザ・端末情報とIPアドレスを取得し、暗号化して保存します。';
    const statusClass = blocked ? 'bad' : '';

    const serverState = {
        token: data.token,
        browserOk: data.browser.allowed,
        vpnBlocked,
        intelUnavailable: data.intel?.verdict === 'unavailable',
        submitUrl: `/api/webauth/${encodeURIComponent(data.token)}/submit`
    };

    const script = `
(function(){
"use strict";
var S=${jsonForScript(serverState)};
var btn=document.getElementById('auth-button');
var status=document.getElementById('auth-status');
function setStatus(text,kind){status.textContent=text;status.className='status'+(kind?' '+kind:'');}
function enable(){btn.disabled=false;btn.textContent='認証する';}
function disable(text){btn.disabled=true;btn.textContent='認証できません';if(text)setStatus(text,'bad');}

function brandsNow(){
  try{ if(navigator.userAgentData&&Array.isArray(navigator.userAgentData.brands)) return navigator.userAgentData.brands.map(function(b){return {brand:b.brand,version:b.version};}); }catch(e){}
  return null;
}
function clientBrowserCheck(){
  var ua=navigator.userAgent||'';
  var brands=brandsNow();
  var edgeBrand=!!brands&&brands.some(function(b){return /microsoft edge/i.test(String(b.brand||''));});
  var chromeBrand=!!brands&&brands.some(function(b){return /google chrome/i.test(String(b.brand||''));});
  var chromiumBrand=!!brands&&brands.some(function(b){return /chromium/i.test(String(b.brand||''));});
  var edgeUa=/\\bEdg(A|\\/)/.test(ua);
  var chromeUa=/Chrome\\//.test(ua);
  var bad=/(Firefox\\/|FxiOS\\/|CriOS\\/|EdgiOS\\/|OPR\\/|SamsungBrowser|Vivaldi|;\\s*wv\\)|HeadlessChrome)/i.test(ua);
  if(bad)return {ok:false,reason:'このブラウザは非対応です。Google Chrome または Microsoft Edge で開いてください。'};
  if(edgeUa){ if(brands&&!edgeBrand)return {ok:false,reason:'ブラウザ情報が一致しません。Google Chrome または Microsoft Edge で開いてください。'}; return {ok:true}; }
  if(!chromeUa)return {ok:false,reason:'Google Chrome または Microsoft Edge のみ認証できます。'};
  if(brands&&!chromeBrand&&!chromiumBrand)return {ok:false,reason:'ブラウザ情報が一致しません。Google Chrome または Microsoft Edge で開いてください。'};
  if(brands&&edgeBrand)return {ok:false,reason:'ブラウザ情報が一致しません。Google Chrome または Microsoft Edge で開いてください。'};
  return {ok:true};
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
function collect(){
  var gl=webglInfo();
  return Promise.all([canvasHash(),uaCh()]).then(function(res){
    var touch={};
    try{touch={maxTouchPoints:navigator.maxTouchPoints||0,touchEvent:('ontouchstart' in window)};}catch(e){}
    var tz='';
    try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){}
    return {
      userAgent:String(navigator.userAgent||''),
      uaCh:res[1]||{},
      screen:{width:screen.width,height:screen.height,colorDepth:screen.colorDepth,pixelDepth:screen.pixelDepth},
      timezone:tz,
      languages:Array.isArray(navigator.languages)?navigator.languages.slice(0,20):[],
      hardwareConcurrency:navigator.hardwareConcurrency||0,
      deviceMemory:navigator.deviceMemory||0,
      canvasHash:res[0]||'',
      webglVendor:gl.vendor,
      webglRenderer:gl.renderer,
      touch:touch
    };
  });
}

var check=clientBrowserCheck();
if(!check.ok)disable(check.reason);
else if(S.vpnBlocked)disable('VPN・プロキシ経由では認証できません。VPNを切断してから再読み込みしてください。');
else enable();
if(S.intelUnavailable&&!S.vpnBlocked){setStatus('IP評価を取得できませんでした。認証は可能ですが「未検証」として記録されます。','warn');}

btn.addEventListener('click',function(){
  if(btn.disabled)return;
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
<div class="features">
<span>Chrome / Edge のみ</span><span>IPはハッシュ化</span><span>端末情報は暗号化</span>
</div>
<button id="auth-button" type="button"${blocked ? ' disabled' : ''}>認証する</button>
<p class="note">
取得したIPアドレスとブラウザ・端末の指紋は、HMACハッシュと暗号化（AES-256-GCM）で保存されます。
同一IP・同一端末のアカウント検出と不正対策の目的にのみ使用し、生の値がWeb APIから返ることはありません。
</p>
`, script, nonce);
}

import { build } from 'esbuild';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = path.resolve('test-results/content-safety-ui');
await fs.mkdir(output, { recursive: true });
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {ContentSafetyControls,SettingSwitch} from './src/web/client/src/pages/Staff/AntiCheat/components/ContentSafetyControls';
function App(){ const [action,setAction]=React.useState('spoiler'); const [on,setOn]=React.useState(true);
return <main><h1>AIコンテンツフィルター</h1><p>検知した投稿の扱いと、検査する内容を選んでください。</p>
<ContentSafetyControls guildId="guild-test" action={action} disabled={false} onChange={setAction}/>
<h2>検査する内容</h2><div className="grid"><SettingSwitch label="画像・GIFを検査" checked={on} onChange={setOn}/><SettingSwitch label="文章を検査" checked={true} disabled onChange={()=>{}}/></div></main>}
createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, outfile: 'preview.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setContent(`<html lang="ja"><meta charset="utf-8"><style>
:root{--app-ink:#172b3b;--app-ink-soft:#45576a;--app-border:#d5dee5;--app-border-strong:#a6b7c5;--app-surface:#fff;--app-surface-soft:#f5f8fa;--app-accent:#167966;--app-accent-strong:#096451;--app-danger:#b33131}
*{box-sizing:border-box}body{background:#edf2f5;font-family:Arial,'Meiryo',sans-serif;margin:0;padding:20px;color:var(--app-ink)}main{max-width:920px;margin:20px auto;background:#fff;padding:24px;border-radius:16px}h1{font-size:24px}h2{font-size:16px;margin-top:28px}p{line-height:1.7}.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}@media(max-width:640px){body{padding:10px}main{padding:18px}}
${css}</style><div id="root"></div></html>`);
    await page.addScriptTag({ content: js });
    await page.evaluate(() => {
      window.fetch = async (url, options) => {
        if (String(url) !== '/api/staff/anticheat/guild-test/content-cache/clear' || options.method !== 'POST') throw new Error('Unexpected cache request');
        return new Response(JSON.stringify({ removed: 3 }), { headers: { 'Content-Type': 'application/json' } });
      };
    });
    await page.getByRole('button', { name: 'このサーバーの判定キャッシュを削除' }).click();
    await page.getByRole('status').filter({ hasText: '3件の判定キャッシュを削除しました' }).waitFor();
    const radio = page.getByRole('radio', { name: /投稿を削除/ });
    await radio.check();
    assert.equal(await radio.isChecked(), true);
    assert.equal(await page.getByText(/誤検知でも元投稿は削除/).count(), 1);
    const toggle = page.getByRole('switch', { name: '画像・GIFを検査' });
    await toggle.focus(); await page.keyboard.press('Space');
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    assert.equal(await page.getByRole('switch', { name: '文章を検査' }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.ok((await toggle.boundingBox()).height >= 44);
    await page.screenshot({ path: path.join(output, `controls-${width}.png`), fullPage: true });
    await page.close();
  }
  console.log('Desktop/mobile selection, keyboard switch, disabled state, overflow and touch targets: passed');
} finally { await browser.close(); }

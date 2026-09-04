import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const role = '111111111111111111', channel = '222222222222222222';
const catalog = {
  roles: [{ id: role, name: '信頼ロール', kind: 'role', type: 'ロール' }],
  channels: [{ id: channel, name: 'VC組専用vc', kind: 'channel', type: 'ボイス' }]
};
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import {ExclusionEditor} from './src/web/client/src/pages/Staff/AntiCheat/components/ExclusionEditor';
function App(){const initial=window.initialState||{roles:'',channels:'',policies:{}};
const [roles,onRoles]=React.useState(initial.roles),[channels,onChannels]=React.useState(initial.channels),[policies,onPolicies]=React.useState(initial.policies);
return <main><h1>除外対象</h1><ExclusionEditor guildId="guild" rolesText={roles} channelsText={channels} onRoles={onRoles} onChannels={onChannels} policies={policies} onPolicies={onPolicies}
detectors={[{key:'contentSafety',title:'AIコンテンツフィルター'},{key:'crossChannelSpam',title:'チャンネル横断スパム'},{key:'raidDetection',title:'自動アンチレイド'}]}/>
<button onClick={()=>{window.saved={roles,channels,policies}}}>設定を保存</button></main>};createRoot(document.getElementById('root')).render(<App/>);`,
    loader: 'tsx', resolveDir: process.cwd() },
  bundle: true, write: false, outfile: 'preview.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
await fs.mkdir('test-results/exclusion-ui', { recursive: true });
const browser = await chromium.launch({ headless: true });
const mount = async (page, initialState) => {
  await page.setContent(`<html lang="ja"><meta charset="utf-8"><style>
  :root{--app-ink:#172b3b;--app-ink-soft:#45576a;--app-border:#d5dee5;--app-border-strong:#a6b7c5;--app-surface:#fff;--app-accent-strong:#096451;--app-danger:#b33131}
  *{box-sizing:border-box}body{font-family:Arial,'Meiryo',sans-serif;margin:0;padding:16px;background:#edf2f5;color:#172b3b}main{max-width:940px;margin:auto;background:white;padding:20px;border-radius:12px}h1{font-size:24px}${css}</style><div id="root"></div></html>`);
  await page.evaluate(({ catalog, initialState }) => {
    window.initialState = initialState;
    window.fetch = async url => {
      if (!String(url).startsWith('/api/staff/anticheat/guild/exclusion-targets')) throw new Error('Unexpected endpoint');
      return new Response(JSON.stringify(catalog));
    };
  }, { catalog, initialState });
  await page.addScriptTag({ content: js });
};
try {
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    await mount(page);
    const roles = page.getByRole('region', { name: '除外ロール', exact: true });
    await roles.getByRole('button', { name: '除外ロールのIDを追加' }).click();
    const input = roles.getByRole('combobox');
    await input.fill(channel);
    await roles.getByRole('button', { name: '追加', exact: true }).click();
    await roles.getByRole('alert').filter({ hasText: 'ボイスです' }).waitFor();
    await input.fill(role);
    await input.press('Enter');
    await roles.getByText('@信頼ロール', { exact: true }).waitFor();
    const channels = page.getByRole('region', { name: '除外チャンネル', exact: true });
    await channels.getByRole('button', { name: '除外チャンネルのIDを追加' }).click();
    await channels.getByRole('combobox').fill(channel);
    await channels.getByRole('button', { name: '追加', exact: true }).click();
    await channels.getByText('#VC組専用vc', { exact: true }).waitFor();
    await channels.getByLabel('このチャンネルの除外方法').selectOption('selected');
    await channels.getByRole('checkbox', { name: 'AIコンテンツフィルター' }).check();
    assert.equal(await channels.getByRole('checkbox', { name: 'チャンネル横断スパム' }).isChecked(), false);
    assert.equal(await channels.getByRole('checkbox', { name: '自動アンチレイド' }).count(), 0);
    await page.getByRole('button', { name: '設定を保存' }).click();
    const saved = await page.evaluate(() => window.saved);
    assert.deepEqual(saved, { roles: role, channels: '', policies: { [channel]: ['contentSafety'] } });
    const reopened = await browser.newPage({ viewport: { width, height: 950 } });
    await mount(reopened, saved);
    await reopened.getByRole('checkbox', { name: 'AIコンテンツフィルター' }).waitFor();
    assert.equal(await reopened.getByRole('checkbox', { name: 'AIコンテンツフィルター' }).isChecked(), true);
    assert.equal(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await reopened.screenshot({ path: `test-results/exclusion-ui/exclusions-${width}.png`, fullPage: true });
    await reopened.getByRole('button', { name: `除外ロール ${role} を削除` }).click();
    await reopened.getByRole('button', { name: `除外チャンネル ${channel} を削除` }).click();
    await reopened.getByRole('button', { name: '設定を保存' }).click();
    assert.deepEqual(await reopened.evaluate(() => window.saved), { roles: '', channels: '', policies: {} });
    await page.close(); await reopened.close();
  }
  console.log('Desktop/mobile: add input persists, wrong-type rejection, labels, selective exclusion, saved-state reload, deletion and overflow passed.');
} finally { await browser.close(); }

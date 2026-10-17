import React,{useEffect,useState} from 'react';
import './SystemManagement.css';
type FileRow={id:string;bytes:number};
type Status={uptimeSeconds:number;systemUptimeSeconds:number;disk:{total:number;used:number;free:number;usedPercent:number};ram:{total:number;used:number;free:number;usedPercent:number;botRss:number;botHeap:number};database:{totalBytes:number;fileCount:number;files:FileRow[];groups:{name:string;bytes:number}[]}};
const format=(n:number)=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':(n/1024).toFixed(1)+' KB';
export default function SystemManagementPage(){
 const [data,setData]=useState<Status|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [query,setQuery]=useState('');
 async function refresh(){
  try{const r=await fetch('/api/system-management/status',{credentials:'include'});if(!r.ok)throw new Error(r.status===403?'オーナー専用ページです':'取得失敗');setData(await r.json());setError('');}
  catch(e){setError(String(e));}
 }
 useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),30000);return()=>clearInterval(id)},[]);
 async function remove(row:FileRow){
  const typed=window.prompt(`データベースから ${row.id} (${format(row.bytes)}) を完全に削除します。\nファイル名を入力して確認してください。`);
  if(typed!==row.id)return;
  setBusy(true);
  try{
   const r=await fetch('/api/system-management/database',{method:'DELETE',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({id:row.id})});
   const json=await r.json();if(!r.ok)throw Error(json.error);await refresh();
  }catch(e){setError(String(e));}finally{setBusy(false)}
 }
 return <main className="sysPanel">
   <header><span className="sysEyebrow">OWNER / SYSTEM</span><h1>システム管理</h1><p>Botプロセスとサーバーの状態・データベース占有状況</p><button onClick={()=>void refresh()}>最新情報へ更新</button></header>
   {error&&<p role="alert" className="sysError">{error}</p>}
   {data&&<>
    <section className="sysGrid">
     {[{title:'ディスク使用率',percent:data.disk.usedPercent,label:`${format(data.disk.used)} / ${format(data.disk.total)}`},
       {title:'システムRAM使用率',percent:data.ram.usedPercent,label:`${format(data.ram.used)} / ${format(data.ram.total)}`},
       {title:'Botメモリ',percent:100*data.ram.botRss/data.ram.total,label:`RSS ${format(data.ram.botRss)} / Heap ${format(data.ram.botHeap)}`},
       {title:'データベース容量',percent:data.disk.total?100*data.database.totalBytes/data.disk.total:0,label:`${format(data.database.totalBytes)} · ${data.database.fileCount}ファイル`}]
      .map(c=><article className="sysCard" key={c.title}><span>{c.title}</span><strong>{c.percent.toFixed(1)}%</strong><div className="sysTrack"><i style={{width:Math.min(100,c.percent)+'%'}}/></div><small>{c.label}</small></article>)}
    </section>
    <section className="sysInfo"><span>Bot稼働時間: {(data.uptimeSeconds/3600).toFixed(1)}時間</span><span>OS稼働時間: {(data.systemUptimeSeconds/3600).toFixed(1)}時間</span><span>ディスク空き: {format(data.disk.free)}</span></section>
    <section className="sysCard"><h2>データベース構成</h2><div className="sysGroups">{data.database.groups.map(g=><div key={g.name}><span>{g.name}</span><strong>{format(g.bytes)}</strong></div>)}</div></section>
    <section className="sysCard"><div className="sysHead"><div><h2>容量の大きいファイル</h2><p>最大100件。削除すると設定・ログ・履歴が失われる場合があります。</p></div><input aria-label="ファイル検索" placeholder="検索" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      <div className="sysFiles">{data.database.files.filter(f=>f.id.toLowerCase().includes(query.toLowerCase())).map(f=><div key={f.id}><span title={f.id}>{f.id}</span><strong>{format(f.bytes)}</strong><button disabled={busy||/^(system|integrations)\//.test(f.id)||!f.id.endsWith('.json')} onClick={()=>void remove(f)}>削除</button></div>)}</div>
    </section></>}
 </main>
}
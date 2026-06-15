'use client';

import { useState, useEffect, useCallback, useRef, DragEvent } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  totalBooks: number; totalChunks: number;
  running: number; errors: number; queued: number;
  bySubject: Record<string, number>;
}
interface Job {
  id: string; book_name: string; subject: string;
  status: string; file_type: 'epub' | 'pdf'; is_image_based: boolean;
  total_chapters: number; total_pages: number;
  done_chapters: number; total_chunks: number;
  error_message: string | null; updated_at: string; created_at: string;
}
interface Chapter {
  chapter_index: number; chapter_title: string;
  status: string; chunks_count: number; error_message: string | null;
}
interface Evt {
  id: number; chapter_index: number | null; ts: string;
  level: 'ok' | 'info' | 'warn' | 'error'; type: string | null; msg: string;
}
interface Chunk {
  id: string; subject: string; topic: string;
  content: string; content_hash: string;
  metadata: Record<string, unknown>;
}
interface LocalBook {
  folder: string; subject: string; filePath: string;
  fileName: string; fileType: 'epub' | 'pdf'; sizeMb: number; ragReadyCount: number;
}

const POLL = 1500;
const STEPS = ['📦 Извлечение', '🤖 Чанкинг AI', '🔢 Эмбеддинги', '💾 Supabase'];
const C: Record<string, string> = {
  done:'#22c55e', running:'#3b82f6', processing:'#3b82f6', archived:'#8b5cf6',
  error:'#ef4444', queued:'#f59e0b', pending:'#94a3b8', paused:'#f59e0b',
};
const fmt  = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fmtD = (iso: string) => new Date(iso).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
const stepOf = (t: string|null) => {
  if (!t) return -1;
  if (t.startsWith('extract')) return 0;
  if (t.startsWith('chunk'))   return 1;
  if (t.startsWith('embed'))   return 2;
  if (t==='supabase_inject'||t==='chapter_done') return 3;
  return -1;
};
const btn = (color: string, small = false): React.CSSProperties => ({
  height: small ? 26 : 30, padding: small ? '0 10px' : '0 14px',
  borderRadius: 8, fontSize: small ? 11 : 12, fontWeight: 600,
  background:`${color}18`, color, border:`1px solid ${color}40`, cursor:'pointer',
  transition:'all 0.1s',
});

// ── Component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats]         = useState<Stats|null>(null);
  const [jobs, setJobs]           = useState<Job[]>([]);
  const [local, setLocal]         = useState<LocalBook[]>([]);
  const [expanded, setExpanded]   = useState<string|null>(null);
  const [chapters, setChapters]   = useState<Chapter[]>([]);
  const [events, setEvents]       = useState<Evt[]>([]);
  const [chunks, setChunks]       = useState<Chunk[]|null>(null);
  const [chunksJobId, setChunksId]= useState<string|null>(null);
  const [clock, setClock]         = useState('');
  const [drag, setDrag]           = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ok:boolean;text:string}|null>(null);
  const [hint, setHint]           = useState('');
  const [confirmHard, setConfirmHard] = useState<string|null>(null);
  const [legacyChunks, setLegacyChunks] = useState<{subject:string;chunks:Chunk[]}|null>(null);
  const cursor = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  // Clock
  useEffect(()=>{
    const t = setInterval(()=>setClock(new Date().toLocaleTimeString('ru-RU')),1000);
    setClock(new Date().toLocaleTimeString('ru-RU'));
    return ()=>clearInterval(t);
  },[]);

  // Local books
  useEffect(()=>{
    fetch('/api/local-books').then(r=>r.json()).then(d=>setLocal(d.books??[]));
  },[]);

  // Poll stats + jobs
  useEffect(()=>{
    let alive = true;
    const tick = async () => {
      try {
        const [s,j] = await Promise.all([
          fetch('/api/stats').then(r=>r.json()),
          fetch('/api/jobs').then(r=>r.json()),
        ]);
        if (!alive) return;
        setStats(s); setJobs(j);
        const running = (j as Job[]).find(x=>x.status==='running');
        if (running) setExpanded(id => id ?? running.id);
      } catch {}
    };
    tick(); const t = setInterval(tick,POLL);
    return ()=>{ alive=false; clearInterval(t); };
  },[]);

  // Poll detail + events for expanded job
  useEffect(()=>{
    if (!expanded) return;
    let alive = true;
    const tick = async () => {
      try {
        const [d,{events:evs}] = await Promise.all([
          fetch(`/api/jobs/${expanded}`).then(r=>r.json()),
          fetch(`/api/jobs/${expanded}/events?after=${cursor.current}`).then(r=>r.json()),
        ]);
        if (!alive) return;
        setChapters(d.chapters??[]);
        if (evs?.length){
          cursor.current = evs[evs.length-1].id;
          setEvents(p=>[...p.slice(-500),...evs]);
          setTimeout(()=>logRef.current?.scrollTo({top:99999,behavior:'smooth'}),50);
        }
      } catch {}
    };
    tick(); const t = setInterval(tick,POLL);
    return ()=>{ alive=false; clearInterval(t); };
  },[expanded]);

  // Load chunks for a job
  const loadChunks = useCallback(async (jobId: string) => {
    if (chunksJobId === jobId) { setChunks(null); setChunksId(null); return; }
    const r = await fetch(`/api/jobs/${jobId}/chunks`);
    const d = await r.json();
    setChunks(d.chunks ?? []);
    setChunksId(jobId);
  },[chunksJobId]);

  // Upload
  const uploadFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(pdf|epub)$/i)){ setUploadMsg({ok:false,text:'Только PDF или EPUB'}); return; }
    setUploading(true); setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('file',file);
      if (hint.trim()) fd.append('subject',hint.trim());
      const res = await fetch('/api/upload-pdf',{method:'POST',body:fd});
      const data = await res.json();
      if (!res.ok){ setUploadMsg({ok:false,text:data.error??'Ошибка'}); return; }
      setUploadMsg({ok:true,text:`✅ "${data.subject}" — поставлен в очередь`});
      setExpanded(data.id); setEvents([]); cursor.current=0; setHint('');
      fetch('/api/local-books').then(r=>r.json()).then(d=>setLocal(d.books??[]));
    } catch(e){ setUploadMsg({ok:false,text:String(e)}); }
    finally { setUploading(false); }
  },[hint]);

  const onDrop = useCallback((e:DragEvent<HTMLDivElement>)=>{
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0]; if(f) uploadFile(f);
  },[uploadFile]);

  const enqueue = useCallback(async (b:LocalBook)=>{
    const res = await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({filePath:b.filePath,subject:b.subject})});
    const j = await res.json();
    if (res.ok&&j?.id){ setExpanded(j.id); setEvents([]); cursor.current=0; }
  },[]);

  const doAction = useCallback(async (id:string, a:string) => {
    if (a==='hard-reset') { setConfirmHard(id); return; }
    await fetch(`/api/jobs/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:a})});
    if (a==='archive') { setExpanded(p=>p===id?null:p); setChunks(null); setChunksId(null); }
  },[]);

  const confirmHardReset = useCallback(async (id: string) => {
    setConfirmHard(null);
    await fetch(`/api/jobs/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'hard-reset'})});
    setEvents([]); cursor.current=0;
  },[]);

  const deleteJob = useCallback(async (id: string) => {
    await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
    if (expanded === id) { setExpanded(null); setEvents([]); cursor.current = 0; }
  }, [expanded]);

  const selectJob = useCallback((id:string) => {
    setExpanded(p=>p===id?null:id); setEvents([]); cursor.current=0;
    setChunks(null); setChunksId(null);
  },[]);

  // Load chunks for a legacy book (no job record) by subject
  const loadLegacyChunks = useCallback(async (subject: string) => {
    if (legacyChunks?.subject === subject) { setLegacyChunks(null); return; }
    const r = await fetch(`/api/chunks?subject=${encodeURIComponent(subject)}`);
    const d = await r.json();
    setLegacyChunks({ subject, chunks: d.chunks ?? [] });
  }, [legacyChunks]);

  // Derived
  const expJob    = jobs.find(j=>j.id===expanded)??null;
  const lastEv    = events[events.length-1];
  const curStep   = stepOf(lastEv?.type??null);
  const isRunning = expJob?.status==='running';
  const workerUp  = jobs.some(j=>j.status==='running');
  const ragList   = Object.entries(stats?.bySubject??{}).sort((a,b)=>b[1]-a[1]);
  const activeJobs   = jobs.filter(j=>j.status!=='archived');
  const archivedJobs = jobs.filter(j=>j.status==='archived');
  const unprocessed  = local.filter(b=>b.ragReadyCount===0);
  // Legacy: subjects in RAG that have no job record at all
  const legacySubjects = ragList.filter(([subj]) => !jobs.some(j=>j.subject===subj));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{minHeight:'100vh',background:'#f1f5f9'}}>

      {/* Hard-reset confirmation modal */}
      {confirmHard && (
        <div style={{
          position:'fixed',inset:0,zIndex:999,background:'rgba(0,0,0,0.5)',
          display:'flex',alignItems:'center',justifyContent:'center',
        }}>
          <div style={{background:'#fff',borderRadius:16,padding:28,maxWidth:420,width:'90%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            <div style={{fontSize:28,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:16,fontWeight:700,color:'#0f172a',marginBottom:8}}>Полный сброс</div>
            <div style={{fontSize:14,color:'#64748b',marginBottom:20,lineHeight:1.6}}>
              Все чанки этой книги будут <b>удалены из RAG</b> и книга будет обработана с нуля.<br/>
              История логов и события сохранятся.
            </div>
            <div style={{display:'flex',gap:10}}>
              <button onClick={()=>confirmHardReset(confirmHard)} style={{
                flex:1,height:40,borderRadius:10,fontSize:14,fontWeight:700,
                background:'#ef4444',color:'#fff',border:'none',cursor:'pointer',
              }}>🗑 Удалить чанки и сбросить</button>
              <button onClick={()=>setConfirmHard(null)} style={{
                flex:1,height:40,borderRadius:10,fontSize:14,fontWeight:600,
                background:'#f1f5f9',color:'#475569',border:'1px solid #e2e8f0',cursor:'pointer',
              }}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <nav style={{
        background:'#0f172a',height:52,display:'flex',alignItems:'center',padding:'0 24px',
        position:'sticky',top:0,zIndex:100,borderBottom:'1px solid #1e293b',
      }}>
        <div style={{maxWidth:1140,margin:'0 auto',width:'100%',display:'flex',alignItems:'center',gap:16}}>
          <span style={{fontFamily:'var(--font-display)',fontWeight:700,fontSize:17,color:'#f8fafc'}}>📚 Zeka Books</span>
          <a href="/" style={{fontSize:13,color:'#e2e8f0',fontWeight:600,textDecoration:'none'}}>🏠 Дашборд</a>
          <a href="/errors" style={{
            fontSize:13,fontWeight:600,textDecoration:'none',
            color:stats?.errors&&stats.errors>0?'#fca5a5':'#94a3b8',
          }}>
            🐛 Ошибки{stats?.errors&&stats.errors>0?` (${stats.errors})`:''}
          </a>
          <span style={{flex:1}}/>
          <span style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{
              width:8,height:8,borderRadius:'50%',display:'inline-block',
              background:workerUp?'#22c55e':'#f59e0b',
              boxShadow:workerUp?'0 0 0 3px rgba(34,197,94,0.25)':'none',
            }}/>
            <span style={{fontSize:12,color:'#94a3b8'}}>{workerUp?'Worker работает':'Worker остановлен'}</span>
          </span>
          <span style={{fontSize:12,color:'#475569',fontFamily:'var(--font-mono)'}}>{clock}</span>
        </div>
      </nav>

      <main style={{maxWidth:1140,margin:'0 auto',padding:'28px 24px 80px'}}>

        {/* Stats */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:28}}>
          {([
            {icon:'📚',label:'Книг в RAG',    val:stats?.totalBooks??'—', color:'#6366f1', href:null       } as const,
            {icon:'🧩',label:'Чанков в базе', val:stats?.totalChunks??'—',color:'#0ea5e9', href:null       } as const,
            {icon:'⚡',label:'В обработке',   val:stats?.running??0,      color:'#f59e0b', href:null       } as const,
            {icon:'❌',label:'С ошибками',    val:stats?.errors??0,       color:'#ef4444', href:'/errors'  } as const,
          ] as {icon:string;label:string;val:number|string;color:string;href:string|null}[]).map(s=>{
            const hasErr = s.label==='С ошибками' && Number(s.val)>0;
            const inner = (
              <div key={s.label} style={{
                background:'#fff',
                border:`1px solid ${hasErr?'#fecaca':'#e2e8f0'}`,
                borderRadius:14,padding:'18px 20px',display:'flex',alignItems:'center',gap:14,
                boxShadow:'0 1px 3px rgba(0,0,0,0.06)',cursor:s.href?'pointer':'default',
              }}>
                <span style={{width:44,height:44,borderRadius:12,display:'flex',alignItems:'center',
                  justifyContent:'center',fontSize:20,background:`${s.color}18`,flexShrink:0}}>{s.icon}</span>
                <div>
                  <div style={{fontSize:24,fontWeight:700,lineHeight:1,color:hasErr?'#ef4444':'#0f172a'}}>{s.val}</div>
                  <div style={{fontSize:12,color:'#64748b',marginTop:3}}>{s.label}</div>
                </div>
              </div>
            );
            return s.href
              ? <a key={s.label} href={s.href} style={{textDecoration:'none'}}>{inner}</a>
              : <div key={s.label}>{inner}</div>;
          })}
        </div>

        {/* Upload */}
        <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,padding:20,marginBottom:28,boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
          <h2 style={{fontSize:15,fontWeight:700,color:'#0f172a',margin:'0 0 14px'}}>📥 Загрузить книгу</h2>
          <input type="text" placeholder="Название предмета (необязательно) — например: Fizika 9"
            value={hint} onChange={e=>setHint(e.target.value)}
            style={{width:'100%',height:40,padding:'0 14px',marginBottom:12,border:'1px solid #e2e8f0',
              borderRadius:10,fontSize:14,color:'#0f172a',background:'#f8fafc',outline:'none',boxSizing:'border-box'}}
          />
          <label style={{cursor:'pointer'}}>
            <input type="file" accept=".pdf,.epub" style={{display:'none'}}
              onChange={e=>{const f=e.target.files?.[0];if(f)uploadFile(f);e.target.value='';}}/>
            <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={onDrop}
              style={{border:`2px dashed ${drag?'#6366f1':'#cbd5e1'}`,borderRadius:12,padding:'28px 24px',
                textAlign:'center',background:drag?'#eef2ff':'#f8fafc',transition:'all 0.15s',cursor:uploading?'wait':'pointer'}}>
              {uploading ? <span style={{fontSize:14,color:'#64748b'}}>⏳ Загружаю и ставлю в очередь...</span> : (
                <>
                  <div style={{fontSize:36,marginBottom:8}}>📥</div>
                  <div style={{fontSize:15,fontWeight:600,color:'#1e293b'}}>Перетащи PDF или EPUB сюда</div>
                  <div style={{fontSize:13,color:'#94a3b8',marginTop:4}}>или нажми для выбора · PDF, EPUB до 200MB</div>
                </>
              )}
            </div>
          </label>
          {uploadMsg&&<div style={{marginTop:12,padding:'10px 14px',borderRadius:10,fontSize:13,
            background:uploadMsg.ok?'#f0fdf4':'#fef2f2',color:uploadMsg.ok?'#15803d':'#dc2626',
            border:`1px solid ${uploadMsg.ok?'#bbf7d0':'#fecaca'}`}}>{uploadMsg.text}</div>}
        </div>

        {/* Unprocessed */}
        {unprocessed.length>0&&(
          <section style={{marginBottom:28}}>
            <h2 style={{fontSize:15,fontWeight:700,color:'#0f172a',margin:'0 0 14px'}}>📂 Ожидают обработки</h2>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(210px,1fr))',gap:12}}>
              {unprocessed.map(b=>(
                <div key={b.filePath} style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:14,padding:16,boxShadow:'0 1px 3px rgba(0,0,0,0.05)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <span style={{width:9,height:9,borderRadius:'50%',background:'#94a3b8',display:'inline-block',flexShrink:0}}/>
                    <span style={{fontSize:14,fontWeight:600,color:'#0f172a'}}>{b.subject}</span>
                  </div>
                  <div style={{fontSize:12,color:'#64748b',marginBottom:12}}>{b.fileType.toUpperCase()} · {b.sizeMb}MB</div>
                  <button onClick={()=>enqueue(b)} style={{width:'100%',height:32,borderRadius:8,
                    fontSize:13,fontWeight:600,background:'#6366f1',color:'#fff',border:'none',cursor:'pointer'}}>
                    ▶ Обработать
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* All books (unified) */}
        {(activeJobs.length>0||legacySubjects.length>0)&&(
          <section style={{marginBottom:28}}>
            <h2 style={{fontSize:15,fontWeight:700,color:'#0f172a',margin:'0 0 14px',display:'flex',alignItems:'center',gap:10}}>
              📚 Книги
              <span style={{fontSize:12,fontWeight:400,color:'#94a3b8'}}>— нажмите на книгу для управления</span>
            </h2>

            {/* Legacy books (in RAG but no job record) */}
            {legacySubjects.map(([subj,cnt])=>{
              const showLC = legacyChunks?.subject===subj;
              const lb = local.find(b=>b.subject===subj);
              return (
                <div key={subj} style={{
                  background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,
                  marginBottom:12,overflow:'hidden',
                  boxShadow:'0 1px 3px rgba(0,0,0,0.05)',
                }}>
                  <div style={{padding:'16px 20px',display:'flex',alignItems:'center',gap:12}}>
                    <span style={{width:11,height:11,borderRadius:'50%',background:'#22c55e',display:'inline-block',flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:15,color:'#0f172a',marginBottom:2}}>{subj}</div>
                      <div style={{fontSize:12,color:'#64748b'}}>
                        {lb?`${lb.fileType.toUpperCase()} · ${lb.sizeMb}MB · `:''}
                        <b style={{color:'#22c55e'}}>{cnt} чанков в RAG</b>
                        <span style={{marginLeft:8,fontSize:10,color:'#94a3b8',background:'#f1f5f9',padding:'2px 7px',borderRadius:99}}>
                          нет записи в очереди
                        </span>
                      </div>
                    </div>
                    <div style={{height:6,width:90,background:'#f1f5f9',borderRadius:99,overflow:'hidden',flexShrink:0}}>
                      <div style={{height:'100%',width:'100%',background:'#22c55e',borderRadius:99}}/>
                    </div>
                  </div>
                  <div style={{padding:'0 20px 14px',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                    <button onClick={()=>loadLegacyChunks(subj)} style={btn('#0ea5e9')}>
                      {showLC?'✕ Скрыть чанки':'🔍 Просмотр чанков'}
                    </button>
                    {lb&&<button onClick={()=>enqueue(lb)} style={btn('#6366f1')}>
                      ↻ Переобработать
                    </button>}
                    <span style={{fontSize:11,color:'#94a3b8'}}>
                      Управление: загрузи книгу повторно или используй ↻ Переобработать
                    </span>
                  </div>
                  {showLC&&legacyChunks&&(
                    <div style={{borderTop:'1px solid #e2e8f0'}}>
                      <div style={{padding:'12px 20px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:10}}>
                        <span style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>🧩 Чанки в RAG</span>
                        <span style={{fontSize:12,color:'#64748b'}}>{legacyChunks.chunks.length} записей · {subj}</span>
                      </div>
                      <div style={{maxHeight:400,overflowY:'auto'}}>
                        {legacyChunks.chunks.map((ch,i)=>(
                          <div key={ch.id} style={{padding:'12px 20px',borderBottom:'1px solid #f1f5f9',
                            background:i%2===0?'#fff':'#fafafa'}}>
                            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
                              <span style={{fontSize:11,color:'#94a3b8',fontFamily:'var(--font-mono)',flexShrink:0}}>#{ch.id}</span>
                              <span style={{fontSize:13,fontWeight:600,color:'#0f172a'}}>{ch.topic}</span>
                              <span style={{marginLeft:'auto',fontSize:10,color:'#94a3b8',fontFamily:'var(--font-mono)'}}>{ch.content_hash.slice(0,8)}</span>
                            </div>
                            <div style={{fontSize:12,color:'#475569',lineHeight:1.6,
                              overflow:'hidden',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical'}}>
                              {ch.content}
                            </div>
                            <div style={{display:'flex',gap:12,marginTop:6,flexWrap:'wrap'}}>
                              {ch.metadata?.bloom_level!=null&&<span style={{fontSize:10,color:'#6366f1',background:'#eef2ff',padding:'2px 8px',borderRadius:99}}>bloom: {String(ch.metadata.bloom_level)}</span>}
                              {ch.metadata?.difficulty!=null&&<span style={{fontSize:10,color:'#0ea5e9',background:'#f0f9ff',padding:'2px 8px',borderRadius:99}}>diff: {String(ch.metadata.difficulty)}/5</span>}
                              {Array.isArray(ch.metadata?.concepts)&&(ch.metadata.concepts as string[]).slice(0,3).map(c=>(
                                <span key={c} style={{fontSize:10,color:'#64748b',background:'#f1f5f9',padding:'2px 8px',borderRadius:99}}>{c}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Books with job records (full management) */}
            {activeJobs.length>0&&<JobList jobs={activeJobs} expanded={expanded} expJob={expJob} chapters={chapters}
              events={events} curStep={curStep} isRunning={isRunning} chunksJobId={chunksJobId}
              chunks={chunks} logRef={logRef} onSelect={selectJob} onAction={doAction} onChunks={loadChunks} onDelete={deleteJob}/>}
          </section>
        )}

        {/* Archive */}
        {archivedJobs.length>0&&(
          <section style={{marginBottom:28}}>
            <h2 style={{fontSize:15,fontWeight:700,color:'#8b5cf6',margin:'0 0 14px',display:'flex',alignItems:'center',gap:8}}>
              🗄 Архив <span style={{fontSize:12,fontWeight:400,color:'#94a3b8'}}>— данные хранятся в RAG, доступны для просмотра</span>
            </h2>
            <JobList jobs={archivedJobs} expanded={expanded} expJob={expJob} chapters={chapters}
              events={events} curStep={curStep} isRunning={isRunning} chunksJobId={chunksJobId}
              chunks={chunks} logRef={logRef} onSelect={selectJob} onAction={doAction} onChunks={loadChunks}
              onDelete={deleteJob} isArchive/>
          </section>
        )}

        {/* Empty */}
        {activeJobs.length===0&&archivedJobs.length===0&&legacySubjects.length===0&&(
          <div style={{textAlign:'center',padding:'80px 24px',color:'#94a3b8'}}>
            <div style={{fontSize:56,marginBottom:16}}>📭</div>
            <div style={{fontSize:18,fontWeight:600,color:'#475569',marginBottom:8}}>Книг пока нет</div>
            <div style={{fontSize:14}}>Загрузи первый PDF или EPUB через форму выше</div>
          </div>
        )}

      </main>

      <style>{`
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.6;}}
        *{box-sizing:border-box;}
        button:hover{filter:brightness(1.08);}
        ::-webkit-scrollbar{width:5px;}
        ::-webkit-scrollbar-track{background:#1e293b;}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:3px;}
      `}</style>
    </div>
  );
}

// ── JobList component ─────────────────────────────────────────────────────────

interface JobListProps {
  jobs: Job[]; expanded: string|null; expJob: Job|null;
  chapters: Chapter[]; events: Evt[]; curStep: number;
  isRunning: boolean; chunksJobId: string|null; chunks: Chunk[]|null;
  logRef: React.RefObject<HTMLDivElement|null>;
  onSelect:(id:string)=>void; onAction:(id:string,a:string)=>void;
  onChunks:(id:string)=>void; onDelete:(id:string)=>void; isArchive?: boolean;
}

function JobList({jobs,expanded,expJob,chapters,events,curStep,isRunning,
  chunksJobId,chunks,logRef,onSelect,onAction,onChunks,onDelete,isArchive}:JobListProps){
  const fmt  = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const fmtD = (iso: string) => new Date(iso).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
  const STEPS = ['📦 Извлечение','🤖 Чанкинг AI','🔢 Эмбеддинги','💾 Supabase'];
  const C: Record<string,string> = {
    done:'#22c55e',running:'#3b82f6',processing:'#3b82f6',archived:'#8b5cf6',
    error:'#ef4444',queued:'#f59e0b',pending:'#94a3b8',paused:'#f59e0b',
  };
  const btn = (color: string): React.CSSProperties => ({
    height:28,padding:'0 12px',borderRadius:7,fontSize:11,fontWeight:600,
    background:`${color}18`,color,border:`1px solid ${color}40`,cursor:'pointer',
  });

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {jobs.map(job=>{
        const isExp = job.id===expanded;
        const pct   = job.total_chapters>0?Math.round(job.done_chapters/job.total_chapters*100):0;
        const col   = C[job.status]??'#94a3b8';
        const showChunks = chunksJobId===job.id;

        return (
          <div key={job.id} style={{
            background:'#fff',borderRadius:16,overflow:'hidden',
            border:`1px solid ${isExp?(isArchive?'#8b5cf6':'#6366f1'):'#e2e8f0'}`,
            boxShadow:isExp?`0 0 0 3px ${isArchive?'rgba(139,92,246,0.1)':'rgba(99,102,241,0.1)'}`:'0 1px 3px rgba(0,0,0,0.05)',
            transition:'all 0.15s',
          }}>

            {/* Header */}
            <div onClick={()=>onSelect(job.id)} style={{padding:'16px 20px',cursor:'pointer',display:'flex',alignItems:'center',gap:12}}>
              <span style={{width:11,height:11,borderRadius:'50%',background:col,display:'inline-block',flexShrink:0,
                boxShadow:job.status==='running'?`0 0 0 4px ${col}30`:'none'}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:15,color:'#0f172a',marginBottom:2}}>{job.subject}</div>
                <div style={{fontSize:12,color:'#64748b'}}>
                  {job.file_type.toUpperCase()}{job.is_image_based?' · скан':' · текст'} · {job.total_pages} стр.
                  {isArchive&&<span style={{marginLeft:8,color:'#8b5cf6'}}>· архив от {fmtD(job.updated_at)}</span>}
                </div>
              </div>
              <div style={{textAlign:'right',flexShrink:0,marginRight:12}}>
                <div style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>{job.done_chapters}/{job.total_chapters} глав</div>
                <div style={{fontSize:12,color:'#64748b'}}>{job.total_chunks} чанков</div>
              </div>
              <div style={{width:90,flexShrink:0}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                  <span style={{fontSize:11,color:col,fontWeight:700}}>{pct}%</span>
                  <span style={{fontSize:10,color:'#94a3b8',textTransform:'capitalize'}}>{job.status}</span>
                </div>
                <div style={{height:6,background:'#f1f5f9',borderRadius:99,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${pct}%`,background:col,borderRadius:99,transition:'width 0.4s'}}/>
                </div>
              </div>
              <span style={{color:'#94a3b8',fontSize:12,flexShrink:0}}>{isExp?'▲':'▼'}</span>
            </div>

            {/* Action buttons */}
            <div style={{padding:'0 20px 14px',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              {isArchive ? (
                <>
                  <button onClick={()=>onChunks(job.id)} style={btn('#8b5cf6')}>
                    {showChunks?'✕ Скрыть':'🔍 Чанки'}
                  </button>
                  <button onClick={()=>onAction(job.id,'unarchive')} style={btn('#22c55e')}>↩ Восстановить</button>
                  <button onClick={()=>onAction(job.id,'reset')} style={btn('#f59e0b')}>↺ Переобработать</button>
                  <button onClick={()=>onAction(job.id,'hard-reset')} style={btn('#ef4444')}>🗑 Полный сброс</button>
                </>
              ) : (
                <>
                  {['queued','error','paused','done'].includes(job.status)&&(
                    <button onClick={()=>onAction(job.id,'start')} style={btn('#22c55e')}>▶ Запустить</button>
                  )}
                  {job.status==='running'&&(
                    <button onClick={()=>onAction(job.id,'pause')} style={btn('#f59e0b')}>⏸ Пауза</button>
                  )}
                  {job.status==='error'&&(
                    <button onClick={()=>onAction(job.id,'retry')} style={btn('#3b82f6')}>↻ Повторить ошибки</button>
                  )}
                  <button onClick={()=>onAction(job.id,'reset')} style={btn('#64748b')}>↺ Сброс</button>
                  <button onClick={()=>onAction(job.id,'hard-reset')} style={btn('#ef4444')}>🗑 Полный сброс</button>
                  <button onClick={()=>onAction(job.id,'archive')} style={btn('#8b5cf6')}>🗄 Архивировать</button>
                  {job.status!=='running'&&<button onClick={()=>onDelete(job.id)} style={btn('#dc2626')}>🗑 Удалить</button>}
                  {job.status!=='running'&&<button onClick={()=>onChunks(job.id)} style={btn('#0ea5e9')}>
                    {showChunks?'✕ Чанки':'🔍 Чанки'}
                  </button>}
                  {job.error_message&&<span style={{fontSize:11,color:'#ef4444'}}>⚠ {job.error_message.slice(0,70)}</span>}
                </>
              )}
            </div>

            {/* Expanded */}
            {isExp&&(
              <div style={{borderTop:'1px solid #f1f5f9'}}>

                {/* Pipeline steps */}
                {isRunning&&curStep>=0&&(
                  <div style={{padding:'16px 20px',borderBottom:'1px solid #f1f5f9',display:'flex',gap:8}}>
                    {STEPS.map((name,i)=>{
                      const s = i<curStep?'done':i===curStep?'running':'pending';
                      return (
                        <div key={name} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
                          <div style={{width:34,height:34,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
                            background:s==='done'?'#22c55e':s==='running'?'#3b82f6':'#e2e8f0',
                            color:s==='pending'?'#94a3b8':'#fff',fontSize:14,fontWeight:700,
                            boxShadow:s==='running'?'0 0 0 6px rgba(59,130,246,0.2)':'none'}}>
                            {s==='done'?'✓':i+1}
                          </div>
                          <span style={{fontSize:11,color:'#64748b',textAlign:'center',lineHeight:1.3}}>{name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Chapter grid */}
                <div style={{padding:'16px 20px',borderBottom:'1px solid #f1f5f9'}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#475569',marginBottom:12}}>
                    Главы ({chapters.length}/{expJob?.total_chapters??'?'})
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(115px,1fr))',gap:8}}>
                    {chapters.map(ch=>{
                      const c = C[ch.status]??'#94a3b8';
                      return (
                        <div key={ch.chapter_index} style={{border:`1px solid ${c}50`,borderRadius:10,
                          padding:'9px 11px',background:`${c}08`}}>
                          <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:4}}>
                            <span style={{width:7,height:7,borderRadius:'50%',background:c,display:'inline-block'}}/>
                            <span style={{fontSize:12,fontWeight:700,color:'#0f172a'}}>Гл.{ch.chapter_index}</span>
                          </div>
                          <div style={{fontSize:10,color:'#64748b',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{ch.chapter_title}</div>
                          {ch.chunks_count>0&&<div style={{fontSize:10,color:c,fontWeight:700,marginTop:3}}>{ch.chunks_count} чанков</div>}
                          {ch.error_message&&<div style={{fontSize:10,color:'#ef4444',marginTop:2}} title={ch.error_message}>⚠ ошибка</div>}
                        </div>
                      );
                    })}
                    {expJob&&chapters.length<expJob.total_chapters&&
                      Array.from({length:expJob.total_chapters-chapters.length},(_,i)=>(
                        <div key={`p${i}`} style={{border:'1px solid #e2e8f0',borderRadius:10,padding:'9px 11px',background:'#f8fafc'}}>
                          <div style={{display:'flex',alignItems:'center',gap:5}}>
                            <span style={{width:7,height:7,borderRadius:'50%',background:'#cbd5e1',display:'inline-block'}}/>
                            <span style={{fontSize:12,fontWeight:700,color:'#94a3b8'}}>Гл.{chapters.length+i+1}</span>
                          </div>
                          <div style={{fontSize:10,color:'#cbd5e1',marginTop:4}}>ожидает</div>
                        </div>
                      ))
                    }
                  </div>
                </div>

                {/* Live log */}
                <div>
                  <div style={{padding:'10px 20px',display:'flex',alignItems:'center',gap:8,background:'#0f172a',borderBottom:'1px solid #1e293b'}}>
                    <span style={{width:10,height:10,borderRadius:'50%',background:'#ef4444',display:'inline-block'}}/>
                    <span style={{width:10,height:10,borderRadius:'50%',background:'#f59e0b',display:'inline-block'}}/>
                    <span style={{width:10,height:10,borderRadius:'50%',background:'#22c55e',display:'inline-block'}}/>
                    <span style={{fontSize:12,color:'#475569',marginLeft:6,fontFamily:'var(--font-mono)'}}>Live Log — {expJob?.book_name}</span>
                    <span style={{marginLeft:'auto',fontSize:11,color:'#334155'}}>{events.length} событий</span>
                  </div>
                  <div ref={logRef} style={{height:280,overflowY:'auto',background:'#0f172a',
                    padding:'14px 20px',fontFamily:'var(--font-mono)',fontSize:12.5,
                    display:'flex',flexDirection:'column',gap:4}}>
                    {events.length===0?(
                      <span style={{color:'#334155'}}>// Ожидаю события от воркера...</span>
                    ):events.slice(-300).map(e=>(
                      <div key={e.id} style={{display:'flex',gap:14,lineHeight:1.6}}>
                        <span style={{color:'#334155',flexShrink:0}}>{fmt(e.ts)}</span>
                        <span style={{color:e.level==='ok'?'#22c55e':e.level==='error'?'#ef4444':e.level==='warn'?'#f59e0b':'#94a3b8',wordBreak:'break-word'}}>{e.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Chunks browser */}
            {showChunks&&chunks&&(
              <div style={{borderTop:'1px solid #e2e8f0'}}>
                <div style={{padding:'12px 20px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:13,fontWeight:700,color:'#0f172a'}}>🧩 Чанки в RAG</span>
                  <span style={{fontSize:12,color:'#64748b'}}>{chunks.length} записей · {job.subject}</span>
                </div>
                <div style={{maxHeight:400,overflowY:'auto'}}>
                  {chunks.map((ch,i)=>(
                    <div key={ch.id} style={{padding:'12px 20px',borderBottom:'1px solid #f1f5f9',
                      background:i%2===0?'#fff':'#fafafa'}}>
                      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
                        <span style={{fontSize:11,color:'#94a3b8',fontFamily:'var(--font-mono)',flexShrink:0}}>#{ch.id}</span>
                        <span style={{fontSize:13,fontWeight:600,color:'#0f172a'}}>{ch.topic}</span>
                        <span style={{marginLeft:'auto',fontSize:10,color:'#94a3b8',fontFamily:'var(--font-mono)'}}>{ch.content_hash.slice(0,8)}</span>
                      </div>
                      <div style={{fontSize:12,color:'#475569',lineHeight:1.6,
                        overflow:'hidden',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical'}}>
                        {ch.content}
                      </div>
                      <div style={{display:'flex',gap:12,marginTop:6,flexWrap:'wrap'}}>
                        {ch.metadata?.bloom_level!=null&&<span style={{fontSize:10,color:'#6366f1',background:'#eef2ff',padding:'2px 8px',borderRadius:99}}>bloom: {String(ch.metadata.bloom_level)}</span>}
                        {ch.metadata?.difficulty!=null&&<span style={{fontSize:10,color:'#0ea5e9',background:'#f0f9ff',padding:'2px 8px',borderRadius:99}}>diff: {String(ch.metadata.difficulty)}/5</span>}
                        {Array.isArray(ch.metadata?.concepts)&&(ch.metadata.concepts as string[]).slice(0,3).map(c=>(
                          <span key={c} style={{fontSize:10,color:'#64748b',background:'#f1f5f9',padding:'2px 8px',borderRadius:99}}>{c}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

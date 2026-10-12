/* Recall practice: read existing decks; write only this independent store. */
window.RecallPractice = (() => {
  "use strict";
  const KEY = "recall_practice_v1";
  const defaults = { think:1.5, chunk:0.9, reveal:"chunk", example:"ielts", group:"all", pattern:"", front:2, back:3, gap:0.5, loop:true, sound:false };
  let settings = {...defaults}, saved = {}, mode = "speaking", data = [], loading = null;
  let run = null, timer = null, epoch = 0, due = 0, visual = 0, remaining = null, filtered = null;
  const el = id => document.getElementById(id);
  const esc = s => escapeHTML(s);
  const number = (v, min, max, fallback) => Number.isFinite(+v) ? Math.max(min, Math.min(max, +v)) : fallback;
  function write() {
    try { localStorage.setItem(KEY, JSON.stringify({version:1, settings, saved})); }
    catch { el("practiceNotice").textContent = "練習の途中位置を保存できません。この画面では練習を続けられます。"; }
  }
  function checkpoint() {
    if(run) saved[mode] = {queue:run.queue, idx:run.idx, phase:run.phase, revealed:run.revealed, round:run.round};
    write();
  }
  function cancel() { clearTimeout(timer); timer=null; epoch++; stopSpeak(); }
  function schedule(ms) {
    clearTimeout(timer); const token=epoch;
    due=performance.now()+ms;
    timer=setTimeout(() => { timer=null; if(token!==epoch || !run?.playing || document.hidden || document.body.dataset.view!=="practice") return; tick(); }, ms);
  }
  function pause(message) {
    if(run?.playing) { remaining=timer===null?null:Math.max(0,due-performance.now()); run.playing=false; }
    cancel(); if(run) { checkpoint(); render(); }
    if(message) el("practiceNotice").textContent=message;
  }
  function sceneHit(deckId, en) {
    const deck=APP.decks[deckId]; if(!deck) return null;
    for(const scene of scScenesForDeck(deck)) {
      const n=scene.words.findIndex(w => w.en.toLowerCase()===(en||"").toLowerCase());
      if(n>=0) return {scene, word:scene.words[n], n:n+1};
    }
    return null;
  }
  function crop(deckId, card) {
    const box=el("practiceImage"), hit=sceneHit(deckId,card.en), token=++visual;
    box.style.backgroundImage="none"; box.classList.remove("loaded");
    el("practiceImageLabel").textContent=hit?"場面画像を読み込み中…":"このデッキに対応する場面画像は未登録です";
    if(!hit) return;
    const img=new Image();
    img.onload=() => {
      if(token!==visual || mode!=="auto" || document.body.dataset.view!=="practice") return;
      const z=2.2, ratio=9/25, ar=hit.scene.h/hit.scene.w, clamp=v=>Math.max(0,Math.min(1,v));
      const px=clamp((z*hit.word.x-0.5)/(z-1)), py=clamp((z*ar*hit.word.y-ratio/2)/(z*ar-ratio));
      box.style.backgroundImage=`url("${hit.scene.image}")`; box.style.backgroundSize=`${z*100}% auto`;
      box.style.backgroundPosition=`${px*100}% ${py*100}%`;
      box.querySelector("i").style.left=((z*hit.word.x-px*(z-1))*100)+"%";
      box.querySelector("i").style.top=((z*ar*hit.word.y-py*(z*ar-ratio))/ratio*100)+"%";
      box.classList.add("loaded"); el("practiceImageLabel").textContent=`${hit.n}. ${hit.scene.title}`;
    };
    img.onerror=()=>{ if(token===visual) el("practiceImageLabel").textContent="場面画像を読み込めません。オンラインでこの語を一度開いてください。"; };
    img.src=hit.scene.image;
  }
  function validate(items) {
    if(!Array.isArray(items) || !items.length) throw new Error("構文データが空です");
    const ids=new Set();
    for(const p of items) {
      if(!p.id || ids.has(p.id) || ![p.title,p.meaning,p.nuance,p.coreImage].every(x=>typeof x==="string" && x)) throw new Error("構文データの項目を確認してください");
      ids.add(p.id);
      for(const kind of ["ielts","business"]) {
        const x=p[kind]; if(!x?.en || !x.ja || !Array.isArray(x.chunks) || !x.chunks.length || x.chunks.some(c=>typeof c!=="string" || !c.trim()) || x.chunks.join(" ")!==x.en) throw new Error(`${p.id} のチャンクが英文に一致しません`);
      }
    }
    return items;
  }
  function loadData() {
    if(loading) return loading;
    loading=fetch("speaking.json", {cache:"no-cache"}).then(r=>{ if(!r.ok) throw new Error(`構文データ HTTP ${r.status}`); return r.json(); })
      .then(validate).then(items=>{ data=items; renderHome(); return items; })
      .catch(e=>{ loading=null; el("practiceNotice").textContent=`英会話データを読み込めません（${e.message}）。オンラインで再度開いてください。`; return []; });
    return loading;
  }
  function renderHome() {
    if(!el("practiceHome")) return;
    el("speakingCount").textContent=data.length?`${data.length}構文・${data.length*2}例文`:"IELTS・ビジネス";
    document.querySelectorAll("#deckList .dc-actions").forEach(box=>{
      if(box.querySelector("[data-practice-deck]")) return;
      const id=box.closest("[data-id]").dataset.id;
      const btn=document.createElement("button"); btn.className="btn ghost sm"; btn.dataset.practiceDeck=id;
      btn.textContent="▷ 自動フラッシュ"; box.prepend(btn);
    });
  }
  function speakingQueue() {
    const patterns=data.filter(p=> (!settings.pattern || p.id===settings.pattern) && (settings.group==="all" || (settings.group==="priority"?p.priority:settings.group==="original"?+p.id.slice(1)<=30:+p.id.slice(1)>30)));
    const kinds=settings.example==="both"?["ielts","business"]:[settings.example];
    return patterns.flatMap(p=>kinds.map(kind=>({id:p.id,kind})));
  }
  function categoryOf(d) { return /^Lv60/i.test(d.name)?"lv60":/^Lv80/i.test(d.name)?"lv80":scScenesForDeck(d).length || /^\d{2}_/.test(d.name)?"field":"other"; }
  function candidates() {
    const category=el("practiceCategory").value, deck=el("practiceDeck").value;
    return Object.values(APP.decks).filter(d=>(category==="all" || categoryOf(d)===category) && (!deck || d.id===deck))
      .flatMap(d=>Object.keys(d.cards).filter(k=>!filtered || d.id!==filtered.id || filtered.keys.includes(k)).map(key=>({deckId:d.id,key})));
  }
  function scopeChanged(resetRange=true) {
    const category=el("practiceCategory").value, old=el("practiceDeck").value;
    const decks=Object.values(APP.decks).filter(d=>category==="all" || categoryOf(d)===category);
    el("practiceDeck").innerHTML='<option value="">すべてのデッキ</option>'+decks.map(d=>`<option value="${esc(d.id)}">${esc(d.name)} (${Object.keys(d.cards).length}語)</option>`).join("");
    if(decks.some(d=>d.id===old)) el("practiceDeck").value=old;
    updateRange(resetRange);
  }
  function updateRange(reset=true) {
    const n=mode==="speaking"?speakingQueue().length:candidates().length;
    for(const id of ["practiceFrom","practiceTo"]) el(id).max=Math.max(1,n);
    if(reset) { el("practiceFrom").value=1; el("practiceTo").value=Math.max(1,n); }
    el("practiceScope").textContent=mode==="speaking"?`${n}例文を選択中`:`${n}語を選択中${filtered?"（単語リストの絞り込みを適用）":""}`;
    el("practiceStart").disabled=!n;
  }
  function syncControls() {
    const fields={Think:"think",Chunk:"chunk",Reveal:"reveal",Example:"example",Group:"group",Front:"front",Back:"back",Gap:"gap"};
    for(const [name,key] of Object.entries(fields)) el("practice"+name).value=settings[key];
    el("practiceLoop").checked=settings.loop; el("practiceSound").checked=settings.sound;
    el("practicePattern").innerHTML='<option value="">すべての構文</option>'+data.map(p=>`<option value="${esc(p.id)}">${p.id} ${esc(p.title)}</option>`).join("");
    el("practicePattern").value=settings.pattern;
    el("practiceSpeakingSettings").hidden=mode!=="speaking"; el("practiceAutoSettings").hidden=mode!=="auto";
    el("practiceModeSpeaking").classList.toggle("solid",mode==="speaking"); el("practiceModeAuto").classList.toggle("solid",mode==="auto");
    el("practiceHeading").textContent=mode==="speaking"?"英会話編":"自動フラッシュ";
    el("practiceHelp").textContent=mode==="speaking"?"日本語 → 考える時間 → 英語を意味チャンクで表示。全文で止まります。Enter・カードをタップで次へ。":"英語と場面画像 → 日本語・コアイメージ・登録済み例文。正答率や記憶評価には加算しません。";
    el("practiceResume").hidden=!saved[mode]?.queue?.length;
  }
  async function open(nextMode, deckId=null, keys=null) {
    pause(); visual++; mode=nextMode; run=null; remaining=null;
    filtered=keys&&deckId?{id:deckId,keys:[...keys]}:null;
    showView("practice"); el("practiceNotice").textContent=""; const token=epoch;
    if(mode==="speaking") await loadData();
    if(token!==epoch || document.body.dataset.view!=="practice") return;
    syncControls(); el("practiceCategory").value=deckId&&APP.decks[deckId]?categoryOf(APP.decks[deckId]):"all";
    el("practiceDeck").value=""; scopeChanged();
    if(deckId && APP.decks[deckId]) { el("practiceDeck").value=deckId; updateRange(); }
    el("practiceOptions").open=true; render();
  }
  function usable(ref) { return mode==="speaking"?data.some(p=>p.id===ref.id && ["ielts","business"].includes(ref.kind)):!!APP.decks[ref.deckId]?.cards[ref.key]; }
  function start(resume=false) {
    pause(); visual++; remaining=null;
    if(resume) {
      const old=saved[mode]; if(!old?.queue?.length) return;
      // Reconcile saved references without ever copying cards into the legacy store.
      const queue=old.queue.filter(usable), current=old.queue[old.idx];
      if(!queue.length) { toast("保存した対象がありません。範囲を選び直してください"); return; }
      const idx=Math.max(0,queue.indexOf(current));
      run={queue,idx,phase:old.phase, revealed:old.revealed||0,round:old.round||1,playing:false};
      if(!["think","chunks","complete","front","back","gap","end"].includes(run.phase)) resetCard(false);
      el("practiceNotice").textContent="途中位置を開きました。再開ボタンで続けられます。";
      renderCard();
    } else {
      const all=mode==="speaking"?speakingQueue():candidates();
      const from=Math.trunc(number(el("practiceFrom").value,1,Math.max(1,all.length),1));
      const to=Math.trunc(number(el("practiceTo").value,from,Math.max(from,all.length),all.length));
      const queue=all.slice(from-1,to); if(!queue.length) return;
      run={queue,idx:0,phase:"",revealed:0,round:1,playing:!document.hidden}; resetCard(run.playing);
      el("practiceNotice").textContent="";
    }
    el("practiceOptions").open=false; checkpoint(); render(); el("practiceCard").focus({preventScroll:true});
  }
  function current() { return run?.queue[run.idx]; }
  function example() { const r=current(), p=data.find(x=>x.id===r?.id); return p?{pattern:p,...p[r.kind]}:null; }
  function chunks() { const x=example(); return x?(settings.reveal==="word"?x.en.split(/\s+/):x.chunks):[]; }
  function resetCard(play) {
    cancel(); remaining=null; visual++;
    run.phase=mode==="speaking"?"think":"front"; run.revealed=0; run.playing=play;
    renderCard(); if(play) schedule((mode==="speaking"?settings.think:settings.front)*1000);
    checkpoint(); render();
  }
  function renderCard() {
    el("practiceSentence").innerHTML=""; el("practiceDetails").hidden=true;
    el("practiceImage").hidden=mode!=="auto"; el("practiceImageLabel").hidden=mode!=="auto";
    if(!run) { el("practicePrompt").textContent="範囲を選んで練習を始めましょう"; el("practiceLabel").textContent=""; return; }
    if(mode==="speaking") {
      const x=example(); if(!x) return;
      el("practiceLabel").textContent=`${current().id} · ${current().kind==="ielts"?"IELTS Speaking":"Business"}`;
      el("practicePrompt").textContent=x.ja;
      renderChunks();
      el("practiceDetails").innerHTML=`<div class="practice-pattern">${esc(x.pattern.title)}</div><p>${esc(x.pattern.meaning)}</p><p><b>ニュアンス</b>　${esc(x.pattern.nuance)}</p><p><b>コアイメージ</b>　${esc(x.pattern.coreImage)}</p>`;
      el("practiceDetails").hidden=run.phase!=="complete";
    } else {
      const ref=current(), d=APP.decks[ref.deckId], c=d?.cards[ref.key]; if(!c) return;
      el("practiceLabel").textContent=d.name;
      el("practicePrompt").textContent=c.en; crop(ref.deckId,c);
      el("practiceDetails").innerHTML=`<div class="practice-meaning">${esc(c.ja||"日本語訳は未登録です")}</div><p><b>コアイメージ</b>　${esc(c.core||"未登録です")}</p><div class="practice-example">${c.example?`<p lang="en">${esc(c.example)}</p>${c.exampleJa?`<p>${esc(c.exampleJa)}</p>`:""}`:"<p>例文は未登録です</p>"}</div>`;
      el("practiceDetails").hidden=run.phase==="front";
      el("practiceImage").hidden=el("practiceImageLabel").hidden=run.phase!=="front";
    }
  }
  function renderChunks() {
    const a=chunks(); run.revealed=Math.min(run.revealed,a.length);
    el("practiceSentence").innerHTML=a.slice(0,run.revealed).map((s,i)=>`<span class="practice-chunk${i===run.revealed-1?" current":""}" lang="en">${esc(s)}</span>`).join(" ");
  }
  function render() {
    el("practiceFlip").hidden=mode!=="auto";
    const live=!!run;
    el("practiceControls").hidden=!live; el("practicePosition").textContent=live?`${run.idx+1} / ${run.queue.length}${mode==="auto"?` · ${run.round}周目`:""}`:"";
    el("practicePrev").disabled=!live || run.idx===0;
    el("practiceNext").disabled=!live || run.idx===run.queue.length-1;
    el("practiceToggle").textContent=run?.playing?"Ⅱ 停止":run?.phase==="complete" || run?.phase==="end"?"↻ もう一度":"▶ 再開";
    el("practiceStatus").textContent=!live?"開始前":run.phase==="complete"?"全文表示 · 次へは Enter / タップ":run.phase==="end"?"範囲の最後 · 再生終了":!run.playing?"停止中":mode==="speaking"?(run.phase==="think"?"日本語から考える時間":"現在のチャンクを強調中"):run.phase==="front"?"表 · 英語と場面画像":run.phase==="back"?"裏 · 意味と例文":"次のカードまでの間隔";
    if(!live) renderCard();
  }
  function tick() {
    if(!run) return;
    if(mode==="speaking") {
      run.phase="chunks"; run.revealed++;
      if(run.revealed>=chunks().length) {
        run.phase="complete"; run.playing=false; el("practiceDetails").hidden=false;
        if(settings.sound) speakSeq([enItem(example().en)]);
      } else schedule(settings.chunk*1000);
      renderChunks();
    } else if(run.phase==="front") {
      run.phase="back"; el("practiceDetails").hidden=false; el("practiceImage").hidden=el("practiceImageLabel").hidden=true;
      if(settings.sound) speakSeq([enItem(APP.decks[current().deckId].cards[current().key].en)]);
      schedule(settings.back*1000);
    } else if(run.phase==="back") { run.phase="gap"; cancel(); schedule(settings.gap*1000); }
    else if(run.phase==="gap") {
      if(run.idx+1>=run.queue.length) {
        if(settings.loop) { run.idx=0; run.round++; resetCard(true); }
        else { cancel(); run.phase="end"; run.playing=false; }
      } else { run.idx++; resetCard(true); }
    }
    checkpoint(); render();
  }
  function toggle() {
    if(!run) return;
    if(run.playing) { pause(); return; }
    if(document.hidden) return;
    cancel(); run.playing=true;
    if(run.phase==="end") { run.idx=0; run.round=1; resetCard(true); return; }
    if(run.phase==="complete") { resetCard(true); return; }
    const ms=remaining??(mode==="speaking"?(run.phase==="think"?settings.think:settings.chunk):run.phase==="front"?settings.front:run.phase==="back"?settings.back:settings.gap)*1000;
    remaining=null; schedule(ms); checkpoint(); render();
  }
  function move(delta) {
    if(!run) return; const idx=Math.max(0,Math.min(run.queue.length-1,run.idx+delta));
    if(idx===run.idx) return;
    const play=mode==="speaking"?!document.hidden:run.playing&&!document.hidden;
    run.idx=idx; resetCard(play);
  }
  function flip() {
    if(!run || mode!=="auto") return; pause();
    run.phase=run.phase==="front"?"back":"front"; remaining=null; renderCard(); checkpoint(); render();
  }
  function onViewChange(name) { if(name!=="practice" && run) { pause(); visual++; } }
  function init() {
    try { const s=JSON.parse(localStorage.getItem(KEY)); if(s?.version===1) { settings={...defaults,...s.settings}; saved=s.saved||{}; } } catch { /* Never touch a malformed legacy store. */ }
    for(const [k,min,max] of [["think",0,20],["chunk",0.1,10],["front",0.2,60],["back",0.2,60],["gap",0,20]]) settings[k]=number(settings[k],min,max,defaults[k]);
    for(const [k,choices] of [["reveal",["chunk","word"]],["example",["ielts","business","both"]],["group",["all","priority","original","additional"]]]) if(!choices.includes(settings[k])) settings[k]=defaults[k];
    el("homeView").querySelector(".hero").insertAdjacentHTML("afterend", `<div id="practiceHome"><div class="section-label">話す・自動で復習</div><button class="practice-menu" id="speakingMenu"><b>英会話編 →</b><span id="speakingCount">IELTS・ビジネス</span><small>日本語から考えて、短い意味チャンクで英語を組み立てる</small></button><button class="practice-menu" id="autoFlashMenu"><b>自動フラッシュ →</b><span>Lv60・Lv80・分野別</span><small>範囲と時間を選んで、単語カードをくり返す</small></button></div>`);
    document.body.insertAdjacentHTML("beforeend", `<section class="view" id="practiceView"><div class="practice-wrap"><header class="practice-top"><button class="btn ghost sm" id="practiceClose">← ホーム</button><h1 id="practiceHeading">英会話編</h1><span id="practicePosition"></span></header><div class="practice-tabs"><button class="btn ghost" id="practiceModeSpeaking">英会話編</button><button class="btn ghost" id="practiceModeAuto">自動フラッシュ</button></div><p id="practiceHelp"></p><details id="practiceOptions" open><summary>範囲・表示時間を設定</summary><div id="practiceSpeakingSettings" class="practice-grid"><label>例文<select id="practiceExample"><option value="ielts">IELTS Speaking</option><option value="business">ビジネス</option><option value="both">両方</option></select></label><label>構文グループ<select id="practiceGroup"><option value="all">すべて</option><option value="priority">優先構文</option><option value="original">基本30構文</option><option value="additional">教材からの追加構文</option></select></label><label class="practice-wide">構文<select id="practicePattern"></select></label><label>考える時間（秒）<input id="practiceThink" type="number" min="0" max="20" step="0.1"></label><label>追加表示の間隔（秒）<input id="practiceChunk" type="number" min="0.1" max="10" step="0.1"></label><label>表示モード<select id="practiceReveal"><option value="chunk">意味チャンク</option><option value="word">語ごと（補助）</option></select></label></div><div id="practiceAutoSettings" class="practice-grid" hidden><label>種類<select id="practiceCategory"><option value="all">すべて</option><option value="lv60">Lv60</option><option value="lv80">Lv80</option><option value="field">分野別</option><option value="other">その他</option></select></label><label>デッキ<select id="practiceDeck"></select></label><label>表の時間（秒）<input id="practiceFront" type="number" min="0.2" max="60" step="0.1"></label><label>裏の時間（秒）<input id="practiceBack" type="number" min="0.2" max="60" step="0.1"></label><label>次カードまで（秒）<input id="practiceGap" type="number" min="0" max="20" step="0.1"></label><label class="practice-check"><input id="practiceLoop" type="checkbox">ループする</label></div><div class="practice-grid"><label>開始番号<input id="practiceFrom" type="number" min="1" step="1"></label><label>終了番号<input id="practiceTo" type="number" min="1" step="1"></label><label class="practice-check practice-wide"><input id="practiceSound" type="checkbox">英文の全文表示・裏面で音声を読む</label></div><p id="practiceScope"></p><div class="practice-actions"><button class="btn solid" id="practiceStart">この範囲で開始</button><button class="btn ghost" id="practiceResume" hidden>前回の途中位置を開く</button></div></details><p id="practiceNotice" role="status"></p><div class="practice-card" id="practiceCard" tabindex="0" role="button" aria-label="練習カード。英会話は次へ、自動フラッシュは表裏を切り替え"><div id="practiceLabel"></div><div id="practicePrompt"></div><div id="practiceSentence" lang="en"></div><div id="practiceImage"><i></i></div><div id="practiceImageLabel"></div><div id="practiceDetails"></div></div><p id="practiceStatus" role="status">開始前</p><div class="practice-actions" id="practiceControls" hidden><button class="btn ghost" id="practicePrev">← 戻る</button><button class="btn solid" id="practiceToggle">▶ 再開</button><button class="btn ghost" id="practiceNext">次へ →</button><button class="btn ghost" id="practiceFlip">表 / 裏</button></div><p class="practice-hint">Enter / → 次へ　← 戻る　Space 停止・再開　Esc ホーム</p></div></section>`);
    el("speakingMenu").onclick=()=>open("speaking"); el("autoFlashMenu").onclick=()=>open("auto");
    el("homeView").addEventListener("click",e=>{ const b=e.target.closest("[data-practice-deck]"); if(b) { e.stopImmediatePropagation(); open("auto",b.dataset.practiceDeck); } }, true);
    el("filterFlashBtn").insertAdjacentHTML("afterend", '<button class="btn ghost sm" id="filterAutoFlashBtn">▷ 自動フラッシュ</button>');
    el("filterAutoFlashBtn").onclick=()=>open("auto",curListId,curFiltered);
    el("practiceClose").onclick=goHome;
    el("practiceModeSpeaking").onclick=()=>open("speaking"); el("practiceModeAuto").onclick=()=>open("auto");
    el("practiceStart").onclick=()=>start(); el("practiceResume").onclick=()=>start(true);
    el("practiceToggle").onclick=toggle; el("practicePrev").onclick=()=>move(-1); el("practiceNext").onclick=()=>move(1); el("practiceFlip").onclick=flip;
    el("practiceCard").onclick=()=>mode==="speaking"?move(1):flip();
    const fields={Think:["think",0,20],Chunk:["chunk",0.1,10],Front:["front",0.2,60],Back:["back",0.2,60],Gap:["gap",0,20]};
    for(const [name,[key,min,max]] of Object.entries(fields)) el("practice"+name).onchange=e=>{ pause(); remaining=null; settings[key]=number(e.target.value,min,max,defaults[key]); e.target.value=settings[key]; write(); };
    for(const [name,key] of Object.entries({Example:"example",Group:"group",Pattern:"pattern",Reveal:"reveal"})) el("practice"+name).onchange=e=>{ pause(); settings[key]=e.target.value; write(); if(key==="reveal" && run) resetCard(false); updateRange(); };
    el("practiceLoop").onchange=e=>{ pause(); settings.loop=e.target.checked; write(); };
    el("practiceSound").onchange=e=>{ pause(); settings.sound=e.target.checked; write(); };
    el("practiceCategory").onchange=()=>{ pause(); filtered=null; el("practiceDeck").value=""; scopeChanged(); };
    el("practiceDeck").onchange=()=>{ pause(); updateRange(); };
    el("practiceOptions").addEventListener("toggle",()=>{ if(el("practiceOptions").open) pause(); });
    document.addEventListener("keydown",e=>{
      if(document.body.dataset.view!=="practice" || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.defaultPrevented || e.target.closest("input,select,textarea,[contenteditable=true]")) return;
      if(e.key==="Escape") { e.preventDefault(); goHome(); }
      else if(e.key==="ArrowLeft") { e.preventDefault(); move(-1); }
      else if(e.key==="ArrowRight" || (e.key==="Enter" && !e.target.closest("button,summary"))) { e.preventDefault(); move(1); }
      else if(e.key===" " && !e.target.closest("button,summary")) { e.preventDefault(); toggle(); }
    });
    document.addEventListener("visibilitychange",()=>{ if(document.hidden && document.body.dataset.view==="practice") pause("画面が非表示になったため停止しました。再開ボタンで続けられます。"); });
    window.addEventListener("pagehide",()=>{ if(run) pause(); });
    loadData();
  }
  return {init,renderHome,onViewChange,sceneHit};
})();

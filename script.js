/* =========================================================
   NOTETAKING — app logic
   Data lives in Firestore under  users/{uid}  as one document,
   so it syncs automatically across every device you sign into.
   See firebase-config.js for the one-time setup you need to do.
   ========================================================= */

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS  = ['S','M','T','W','T','F','S'];

/* ---------------------------------------------------------
   STATE
   --------------------------------------------------------- */
function defaultState(){
  return { classes: [], todos: [], events: [], notes: [], settings: { notesCalSide: 'right', notesLineHeight: '1.6', notesParaSpacing: 'md' } };
}
let state = defaultState(); // replaced with real data once signed in

// transient UI state (not persisted)
let ui = {
  view: 'home',        // 'home' | 'class'
  classId: null,
  collapsed: {},        // classId -> bool (todo panel collapsed)
  miniCalCollapsed: {},  // classId -> bool (mini-calendar collapsed)
  homeCal: currentMonthCursor(),
  classCal: {},          // classId -> {year,month}
  notesDate: {},         // classId -> 'YYYY-MM-DD'
  addingClass: false,    // sidebar inline "new class" input showing
  renamingClassId: null, // sidebar inline rename input showing
};

/* ---------------------------------------------------------
   FIREBASE: AUTH + FIRESTORE SYNC
   --------------------------------------------------------- */
const db = firebase.firestore();
let currentUser = null;
let unsubscribeSnapshot = null;

function userDocRef(uid){ return db.collection('users').doc(uid); }

function normalizeClass(c){
  // Migrates classes saved under the old fixed-field shape (website/discord/
  // lectureInfo/days) into the new flexible links[] / meetings[] arrays.
  if(!c.links){
    c.links = [];
    if(c.website) c.links.push({ label: 'Website', url: c.website });
    if(c.discord) c.links.push({ label: 'Discord', url: c.discord });
  }
  if(!c.meetings){
    c.meetings = [];
    if(c.days && c.days.some(Boolean)){
      c.meetings.push({ label: c.lectureInfo || 'Class', days: c.days, time: '' });
    }
  }
  return c;
}

function normalizeTodo(t){
  if(!t.links){ t.links = t.link ? [t.link] : []; }
  return t;
}

function attachFirestoreListener(uid){
  unsubscribeSnapshot = userDocRef(uid).onSnapshot(async snap => {
    if(snap.exists){
      const data = snap.data();
      state = {
        classes: (data.classes || []).map(normalizeClass),
        todos: (data.todos || []).map(normalizeTodo),
        events: data.events || [],
        notes: data.notes || [],
        settings: Object.assign({ notesCalSide: 'right', notesLineHeight: '1.6', notesParaSpacing: 'md' }, data.settings || {}),
      };
    } else {
      state = defaultState();
      await userDocRef(uid).set(state);
    }
    // Don't yank the cursor out of the notes editor while someone is mid-sentence.
    const typingInNotes = document.activeElement && document.activeElement.id === 'notesEditable';
    if(!typingInNotes) render();
  }, err => {
    console.error('Sync error:', err);
  });
}

function saveState(){
  if(!currentUser) return;
  userDocRef(currentUser.uid).set(state).catch(err => console.error('Save failed:', err));
}

function friendlyAuthError(err){
  const map = {
    'auth/popup-closed-by-user': 'Sign-in was closed before finishing — try again.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup — allow popups for this site and try again.',
    'auth/cancelled-popup-request': 'Sign-in was cancelled — try again.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Firebase isn\'t configured yet — check firebase-config.js.',
    'auth/operation-not-allowed': 'Google sign-in isn\'t enabled yet — enable it in the Firebase console under Authentication > Sign-in method.',
  };
  return map[err.code] || err.message;
}

firebase.auth().onAuthStateChanged(user => {
  if(user){
    currentUser = user;
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('userEmailLabel').textContent = user.email || user.displayName || '';
    attachFirestoreListener(user.uid);
  } else {
    currentUser = null;
    if(unsubscribeSnapshot){ unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    state = defaultState();
    document.getElementById('app').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
  }
});

document.getElementById('googleSignInBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('authError');
  errEl.classList.add('hidden');
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
  }catch(err){
    errEl.textContent = friendlyAuthError(err);
    errEl.classList.remove('hidden');
  }
});

document.getElementById('signOutBtn').addEventListener('click', () => firebase.auth().signOut());

/* ---------------------------------------------------------
   DATE HELPERS
   --------------------------------------------------------- */
function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function toDateStr(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function todayStr(){ return toDateStr(new Date()); }
function parseDateStr(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function currentMonthCursor(){ const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; }
function niceDate(dateStr){
  if(!dateStr) return '';
  const d = parseDateStr(dateStr);
  return d.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function escapeHtml(str){
  return (str||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------------------------------------------------------
   DATA HELPERS
   --------------------------------------------------------- */
function getClass(id){ return state.classes.find(c => c.id === id); }
function classTodos(classId){ return state.todos.filter(t => t.classId === classId); }
function findNote(classId, dateStr){ return state.notes.find(n => n.classId === classId && n.date === dateStr); }

function todosDueOn(dateStr){ return state.todos.filter(t => t.dueDate === dateStr); }
function eventsOn(dateStr){ return state.events.filter(e => e.date === dateStr); }
function classesMeetingOn(dateStr){
  const weekday = parseDateStr(dateStr).getDay();
  return state.classes.filter(c => (c.meetings||[]).some(m => m.days && m.days[weekday]));
}

/* =========================================================
   RENDER: SIDEBAR
   ========================================================= */
const CLASS_COLOR_PALETTE = ['#e3a63f','#9c7fb3','#4c9a5b','#5b8fd1','#d1495b','#3fae9c'];

function renderSidebar(){
  const list = document.getElementById('classNavList');
  const homeBtn = document.getElementById('homeNavBtn');
  homeBtn.classList.toggle('active', ui.view === 'home');

  let rowsHtml = state.classes.map(c => {
    if(ui.renamingClassId === c.id){
      return `<div class="class-nav-row" data-id="${c.id}">
        <input type="text" class="inline-edit-input" id="renameInput" value="${escapeHtml(c.name)}">
      </div>`;
    }
    return `<div class="class-nav-row" draggable="true" data-id="${c.id}">
      <button class="nav-item ${ui.view==='class' && ui.classId===c.id ? 'active':''}" data-action="go-class" data-id="${c.id}">
        <span class="nav-dot" style="background:${c.color||'#cdb9dc'}"></span>
        ${escapeHtml(c.name)}
      </button>
      <button class="class-nav-del" title="Delete class" data-action="delete-class" data-id="${c.id}">✕</button>
    </div>`;
  }).join('');

  if(ui.addingClass){
    rowsHtml += `<div class="class-nav-row adding">
      <input type="text" class="inline-edit-input" id="newClassInput" placeholder="Class name...">
    </div>`;
  }

  list.innerHTML = rowsHtml;

  const renameEl = document.getElementById('renameInput');
  if(renameEl){
    renameEl.focus(); renameEl.select();
    renameEl.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ commitRename(); }
      else if(e.key === 'Escape'){ ui.renamingClassId = null; render(); }
    });
    renameEl.addEventListener('blur', commitRename);
  }

  const newEl = document.getElementById('newClassInput');
  if(newEl){
    newEl.focus();
    newEl.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ commitNewClass(newEl.value); }
      else if(e.key === 'Escape'){ ui.addingClass = false; render(); }
    });
    newEl.addEventListener('blur', () => commitNewClass(newEl.value));
  }
}

function commitRename(){
  if(ui.renamingClassId === null) return; // already committed (guards double-fire from blur+Enter)
  const id = ui.renamingClassId;
  ui.renamingClassId = null;
  const el = document.getElementById('renameInput');
  const val = el ? el.value.trim() : '';
  const c = getClass(id);
  if(c && val) c.name = val;
  saveState();
  render();
}

function commitNewClass(name){
  if(!ui.addingClass) return; // already committed (guards double-fire from blur+Enter)
  ui.addingClass = false;
  const trimmed = (name||'').trim();
  if(trimmed){
    const newClass = {
      id: uid(), name: trimmed, subtitle:'',
      links: [], meetings: [],
      color: CLASS_COLOR_PALETTE[state.classes.length % CLASS_COLOR_PALETTE.length],
    };
    state.classes.push(newClass);
    saveState();
    ui.view = 'class'; ui.classId = newClass.id;
  }
  render();
}

function moveClass(draggedId, targetId){
  if(draggedId === targetId) return;
  const draggedIdx = state.classes.findIndex(c => c.id === draggedId);
  const targetIdx = state.classes.findIndex(c => c.id === targetId);
  if(draggedIdx < 0 || targetIdx < 0) return;
  const [item] = state.classes.splice(draggedIdx, 1);
  const newTargetIdx = state.classes.findIndex(c => c.id === targetId);
  state.classes.splice(newTargetIdx, 0, item);
  saveState();
  render();
}

/* =========================================================
   RENDER: HOME VIEW
   ========================================================= */
function renderHome(){
  const content = document.getElementById('content');
  const today = todayStr();
  const allOpenTodos = state.todos.filter(t => !t.done).sort((a,b) => (a.dueDate||'9999').localeCompare(b.dueDate||'9999'));

  const dueToday = todosDueOn(today);
  const evToday = eventsOn(today);
  const classesToday = classesMeetingOn(today);

  content.innerHTML = `
    <div class="page-header">
      <h1>Home</h1>
      <div class="sub">${niceDate(today)}</div>
    </div>

    <!-- AGGREGATED TO-DO LIST -->
    <section class="panel">
      <div class="panel-header">
        <h3>To-do</h3>
        <span class="hint">from every class + general reminders</span>
      </div>
      <form class="todo-add-row" id="homeTodoForm">
        <input class="t-text" type="text" name="text" placeholder="Add a general reminder..." required>
        <input class="t-date" type="date" name="dueDate">
        <button class="btn gold" type="submit">Add</button>
      </form>
      <div class="todo-list">
        ${allOpenTodos.length ? allOpenTodos.map(t => todoItemHtml(t, true)).join('') : `<div class="empty-note">Nothing pending — nice.</div>`}
      </div>
    </section>

    <!-- TODAY -->
    <section class="panel">
      <div class="panel-header"><h3>Today — ${niceDate(today)}</h3></div>
      <div class="today-grid">
        <div class="today-col">
          <h4>Due &amp; events</h4>
          <div class="today-list">
            ${dueToday.length===0 && evToday.length===0 ? `<div class="empty-note">Nothing due today.</div>` : ''}
            ${dueToday.map(t => `<div class="row">📌 ${escapeHtml(t.text)} ${t.classId ? `<span class="row-tag">— ${escapeHtml(getClass(t.classId)?.name||'')}</span>`:''}</div>`).join('')}
            ${evToday.map(e => `<div class="row">🎉 ${escapeHtml(e.title)}</div>`).join('')}
          </div>
        </div>
        <div class="today-col">
          <h4>Classes today</h4>
          <div class="today-list">
            ${classesToday.length===0 ? `<div class="empty-note">No classes marked for today.</div>` : classesToday.map(c => {
              const weekday = parseDateStr(today).getDay();
              const todaysMeetings = (c.meetings||[]).filter(m => m.days && m.days[weekday]);
              const label = todaysMeetings.map(m => `${escapeHtml(m.label||'Class')}${m.time?' '+escapeHtml(m.time):''}`).join(', ');
              return `<div class="row">🎓 ${escapeHtml(c.name)} ${label?`<span class="row-tag">— ${label}</span>`:''}</div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </section>

    <!-- MONTH CALENDAR -->
    <section class="panel">
      <div class="panel-header">
        <div class="cal-nav">
          <button class="icon-btn" data-action="home-cal-prev">←</button>
          <div class="cal-title">${MONTH_NAMES[ui.homeCal.month]} ${ui.homeCal.year}</div>
          <button class="icon-btn" data-action="home-cal-next">→</button>
        </div>
        <button class="btn small ghost" data-action="open-add-event">+ Add event</button>
      </div>
      <div id="homeCalWrap">${calendarHtml(ui.homeCal.year, ui.homeCal.month, { small:false, todayStr: today })}</div>
    </section>
  `;

  document.getElementById('homeTodoForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const text = fd.get('text').trim();
    if(!text) return;
    state.todos.push({ id: uid(), classId: null, text, dueDate: fd.get('dueDate')||'', link:'', done:false });
    saveState();
    render();
  });
}

/* =========================================================
   RENDER: CLASS VIEW
   ========================================================= */
function renderClass(classId){
  const c = getClass(classId);
  const content = document.getElementById('content');
  if(!c){ ui.view='home'; renderHome(); return; }

  if(!ui.classCal[classId]) ui.classCal[classId] = currentMonthCursor();
  if(!ui.notesDate[classId]) ui.notesDate[classId] = todayStr();

  const collapsed = !!ui.collapsed[classId];
  const miniCollapsed = !!ui.miniCalCollapsed[classId];
  const todos = classTodos(classId).sort((a,b) => (a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  const side = (state.settings.notesCalSide === 'left') ? 'flip' : '';
  const links = c.links || [];
  const meetings = c.meetings || [];
  const lineHeight = state.settings.notesLineHeight || '1.6';
  const paraSpacing = state.settings.notesParaSpacing || 'md';
  const note = findNote(classId, ui.notesDate[classId]);

  content.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:10px;">
        <h1>${escapeHtml(c.name)}</h1>
        <button class="btn small ghost" style="color:#f5eefb;border-color:rgba(255,255,255,0.3);" data-action="edit-class" data-id="${classId}">⚙ Edit details</button>
      </div>
      <div class="sub">
        ${c.subtitle ? escapeHtml(c.subtitle) : ''}
        ${meetings.map(m => ` · ${escapeHtml(m.label||'Class')}${m.time?' '+escapeHtml(m.time):''} (${daysShort(m.days)})`).join('')}
        ${links.map(l => ` · <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label||'Link')}</a>`).join('')}
        ${!c.subtitle && meetings.length===0 && links.length===0 ? `<span style="opacity:.7;">No details yet — click "Edit details" to add meeting times and links.</span>` : ''}
      </div>
    </div>

    <!-- COLLAPSIBLE TODO (sits normally at the top, does not follow scroll) -->
    <section class="panel todo-panel ${collapsed?'collapsed':''}" id="classTodoPanel">
      <div class="panel-header">
        <h3>To-do for ${escapeHtml(c.name)}</h3>
        <button class="icon-btn" data-action="toggle-collapse" data-id="${classId}">${collapsed ? '▸ Expand' : '▾ Collapse'}</button>
      </div>
      <form class="todo-add-row" id="classTodoForm">
        <input class="t-text" type="text" name="text" placeholder="Assignment name..." required>
        <input class="t-date" type="date" name="dueDate">
      </form>
      <div class="link-inputs-wrap">
        ${linkInputsHtml('classTodoLinks', [''])}
      </div>
      <button class="btn gold todo-add-btn" type="submit" form="classTodoForm">Add</button>
      <div class="todo-list">
        ${todos.length ? todos.map(t => todoItemHtml(t,false)).join('') : `<div class="empty-note">No assignments yet — add one above.</div>`}
      </div>
    </section>

    <!-- NOTES -->
    <section class="panel">
      <div class="panel-header">
        <h3>Notes</h3>
        <button class="btn small ghost" data-action="flip-notes-cal">⇄ Move calendar</button>
      </div>
      <div class="notes-layout ${side}">
        <div class="notes-main">
          <div class="notes-date-row">
            <label style="font-size:12.5px;color:var(--text-dim);font-weight:600;">Notes for</label>
            <input type="date" id="notesDateInput" value="${ui.notesDate[classId]}">
          </div>
          <div class="toolbar">
            <button type="button" title="Bold" data-cmd="bold"><b>B</b></button>
            <button type="button" title="Italic" data-cmd="italic"><i>I</i></button>
            <button type="button" title="Underline" data-cmd="underline"><u>U</u></button>
            <button type="button" title="Bullet list" data-cmd="insertUnorderedList">• ―</button>
            <button type="button" title="Numbered list" data-cmd="insertOrderedList">1. ―</button>
            <span class="toolbar-sep"></span>
            <select id="fontSizeSelect" class="toolbar-select" title="Font size">
              <option value="2">Small</option>
              <option value="3" selected>Normal</option>
              <option value="4">Medium</option>
              <option value="5">Large</option>
              <option value="6">X-Large</option>
            </select>
            <select id="lineHeightSelect" class="toolbar-select" title="Line spacing">
              <option value="1.3" ${lineHeight==='1.3'?'selected':''}>Spacing 1.0</option>
              <option value="1.6" ${lineHeight==='1.6'?'selected':''}>Spacing 1.15</option>
              <option value="2.0" ${lineHeight==='2.0'?'selected':''}>Spacing 1.5</option>
              <option value="2.4" ${lineHeight==='2.4'?'selected':''}>Spacing 2.0</option>
            </select>
            <select id="paraSpacingSelect" class="toolbar-select" title="Space between paragraphs">
              <option value="none" ${paraSpacing==='none'?'selected':''}>No para. spacing</option>
              <option value="sm" ${paraSpacing==='sm'?'selected':''}>Small para. spacing</option>
              <option value="md" ${paraSpacing==='md'?'selected':''}>Medium para. spacing</option>
              <option value="lg" ${paraSpacing==='lg'?'selected':''}>Large para. spacing</option>
            </select>
          </div>
          <div class="notes-editable ps-${paraSpacing}" id="notesEditable" contenteditable="true"
               style="line-height:${lineHeight};" data-placeholder="Start typing today's notes... (Tab to indent bullet/number levels)">${note ? note.html : ''}</div>
          <div class="autosave-tag" id="autosaveTag">saved</div>
        </div>
        <div class="notes-side ${miniCollapsed?'collapsed':''}" id="notesSidePanel">
          <div class="panel-header">
            <button class="icon-btn mini-collapse-btn" title="${miniCollapsed?'Expand calendar':'Collapse calendar'}" data-action="toggle-minical" data-id="${classId}">${miniCollapsed?'◂':'▸'}</button>
            ${!miniCollapsed ? `
              <h3 style="font-size:14px;">Jump to a date</h3>
              <div class="cal-nav">
                <button class="icon-btn" data-action="mini-cal-prev" data-classid="${classId}">←</button>
                <span style="font-size:12.5px;font-weight:600;">${MONTH_NAMES[ui.classCal[classId].month]} ${ui.classCal[classId].year}</span>
                <button class="icon-btn" data-action="mini-cal-next" data-classid="${classId}">→</button>
              </div>` : ''}
          </div>
          ${!miniCollapsed ? `<div id="miniCalWrap" class="mini-cal">
            ${calendarHtml(ui.classCal[classId].year, ui.classCal[classId].month, { small:true, todayStr: todayStr(), selected: ui.notesDate[classId], classId })}
          </div>` : ''}
        </div>
      </div>
    </section>
  `;

  wireLinkInputs('classTodoLinks');

  document.getElementById('classTodoForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const text = fd.get('text').trim();
    if(!text) return;
    const links = collectLinkInputs('classTodoLinks');
    state.todos.push({ id: uid(), classId, text, dueDate: fd.get('dueDate')||'', links, done:false });
    saveState();
    render();
  });

  // notes date picker
  document.getElementById('notesDateInput').addEventListener('change', e => {
    ui.notesDate[classId] = e.target.value || todayStr();
    renderClass(classId); // safe to fully re-render on explicit date change
  });

  const editable = document.getElementById('notesEditable');

  // toolbar formatting commands (bold/italic/underline/lists)
  document.querySelectorAll('.toolbar [data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault()); // keep selection alive
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      editable.focus();
    });
  });

  // remember the text selection so the font-size dropdown (which steals focus)
  // can still apply to whatever was selected
  let savedRange = null;
  const saveSelection = () => {
    const sel = window.getSelection();
    if(sel.rangeCount > 0 && editable.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  };
  editable.addEventListener('mouseup', saveSelection);
  editable.addEventListener('keyup', saveSelection);

  document.getElementById('fontSizeSelect').addEventListener('change', e => {
    if(savedRange){
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    document.execCommand('fontSize', false, e.target.value);
    editable.focus();
    e.target.value = '3'; // reset — this is "apply size to selection", not a persistent state
  });

  document.getElementById('lineHeightSelect').addEventListener('change', e => {
    editable.style.lineHeight = e.target.value;
    state.settings.notesLineHeight = e.target.value;
    saveState();
  });

  document.getElementById('paraSpacingSelect').addEventListener('change', e => {
    editable.className = `notes-editable ps-${e.target.value}`;
    state.settings.notesParaSpacing = e.target.value;
    saveState();
  });

  // Tab / Shift+Tab: indent or outdent list levels (nested bullets get a
  // different marker automatically via CSS, per depth). Outside a list, Tab
  // just inserts an indent instead of jumping focus out of the editor.
  editable.addEventListener('keydown', e => {
    if(e.key !== 'Tab') return;
    e.preventDefault();
    const inList = document.queryCommandState('insertUnorderedList') || document.queryCommandState('insertOrderedList');
    if(inList){
      document.execCommand(e.shiftKey ? 'outdent' : 'indent');
    } else if(!e.shiftKey){
      document.execCommand('insertText', false, '\u00A0\u00A0\u00A0\u00A0');
    }
  });

  // notes autosave (debounced), does NOT trigger full re-render
  let saveTimer = null;
  editable.addEventListener('input', () => {
    const tag = document.getElementById('autosaveTag');
    tag.textContent = 'saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const dateStr = ui.notesDate[classId];
      let n = findNote(classId, dateStr);
      if(!n){ n = { id: uid(), classId, date: dateStr, html: '' }; state.notes.push(n); }
      n.html = editable.innerHTML;
      saveState();
      tag.textContent = 'saved ✓';
      refreshMiniCal(classId);
    }, 500);
  });
}

function daysShort(days){
  if(!days) return '';
  const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days.map((v,i)=>v?labels[i]:null).filter(Boolean).join('/');
}

function refreshMiniCal(classId){
  const wrap = document.getElementById('miniCalWrap');
  if(!wrap) return;
  wrap.innerHTML = calendarHtml(ui.classCal[classId].year, ui.classCal[classId].month, { small:true, todayStr: todayStr(), selected: ui.notesDate[classId], classId });
}

/* =========================================================
   TODO ITEM HTML
   ========================================================= */
function todoItemHtml(t, showClassTag){
  const cls = t.classId ? getClass(t.classId) : null;
  const links = t.links && t.links.length ? t.links : (t.link ? [t.link] : []);
  return `
    <div class="todo-item ${t.done?'done':''}" data-id="${t.id}">
      <button class="check-btn" data-action="toggle-todo" data-id="${t.id}">✓</button>
      <div class="t-body">
        <div class="t-text">${escapeHtml(t.text)}</div>
        <div class="t-meta">
          ${t.dueDate ? `<span>Due ${niceDate(t.dueDate)}</span>` : ''}
          ${links.map((l,i) => `<a href="${escapeHtml(l)}" target="_blank" rel="noopener">${links.length>1 ? `Link ${i+1}` : 'Open link'} ↗</a>`).join('')}
          ${showClassTag && cls ? `<span class="t-class-tag">${escapeHtml(cls.name)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

/* =========================================================
   REUSABLE: dynamic "add another..." input lists
   used for todo links, class links, and class meeting times
   ========================================================= */
function linkInputsHtml(containerId, values){
  values = (values && values.length) ? values : [''];
  return `
    <div class="link-inputs" id="${containerId}">
      ${values.map(v => `<div class="link-input-row">
        <input class="t-link" type="url" value="${escapeHtml(v)}" placeholder="https://...">
        <button type="button" class="icon-btn remove-row-btn">✕</button>
      </div>`).join('')}
    </div>
    <button type="button" class="btn small ghost add-link-btn" data-target="${containerId}">+ Add another link</button>
  `;
}

function wireLinkInputs(containerId){
  const container = document.getElementById(containerId);
  if(!container) return;
  const addBtn = document.querySelector(`.add-link-btn[data-target="${containerId}"]`);
  const wireRemove = row => {
    const btn = row.querySelector('.remove-row-btn');
    if(btn) btn.addEventListener('click', () => row.remove());
  };
  container.querySelectorAll('.link-input-row').forEach(wireRemove);
  if(addBtn){
    addBtn.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'link-input-row';
      row.innerHTML = `<input class="t-link" type="url" placeholder="https://..."><button type="button" class="icon-btn remove-row-btn">✕</button>`;
      container.appendChild(row);
      wireRemove(row);
      row.querySelector('input').focus();
    });
  }
}

function collectLinkInputs(containerId){
  return Array.from(document.querySelectorAll(`#${containerId} .t-link`))
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

/* =========================================================
   CALENDAR RENDERING (shared by home + mini-cal)
   opts: { small, todayStr, selected, classId }
   ========================================================= */
function calendarHtml(year, month, opts){
  opts = opts || {};
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  // leading days from previous month
  for(let i=0;i<startWeekday;i++){
    const dayNum = daysInPrevMonth - startWeekday + 1 + i;
    const d = new Date(year, month-1, dayNum);
    cells.push({ dateStr: toDateStr(d), dayNum, otherMonth: true });
  }
  // this month
  for(let d=1; d<=daysInMonth; d++){
    const dt = new Date(year, month, d);
    cells.push({ dateStr: toDateStr(dt), dayNum: d, otherMonth: false });
  }
  // trailing days to complete final week row
  while(cells.length % 7 !== 0){
    const idx = cells.length - (startWeekday + daysInMonth);
    const d = new Date(year, month+1, idx+1);
    cells.push({ dateStr: toDateStr(d), dayNum: d.getDate(), otherMonth: true });
  }

  const dow = DOW_LABELS.map(l => `<div class="cal-dow">${l}</div>`).join('');

  const dayCells = cells.map(cell => {
    const isToday = cell.dateStr === opts.todayStr;
    const isSelected = opts.selected && cell.dateStr === opts.selected;
    const dots = [];
    if(todosDueOn(cell.dateStr).length) dots.push('<span class="cal-dot todo"></span>');
    if(eventsOn(cell.dateStr).length) dots.push('<span class="cal-dot event"></span>');
    if(!opts.small && classesMeetingOn(cell.dateStr).length) dots.push('<span class="cal-dot class"></span>');

    const clickAction = opts.small ? 'mini-cal-pick' : 'open-day';
    const classIdAttr = opts.classId ? `data-classid="${opts.classId}"` : '';

    return `<div class="cal-day ${cell.otherMonth?'other-month':''} ${isToday?'today':''} ${isSelected?'selected':''}"
                 data-date="${cell.dateStr}" data-action="${clickAction}" ${classIdAttr}>
              <span class="cal-daynum">${cell.dayNum}</span>
              <span class="cal-dots">${dots.join('')}</span>
            </div>`;
  }).join('');

  return `<div class="cal-grid">${dow}${dayCells}</div>`;
}

/* =========================================================
   DAY MODAL (click a day on the month calendar)
   ========================================================= */
function openDayModal(dateStr){
  const evs = eventsOn(dateStr);
  const dues = todosDueOn(dateStr);
  const classesOn = classesMeetingOn(dateStr);

  showModal(`
    <h3>${niceDate(dateStr)}</h3>

    <div class="day-modal-section">
      <h4>Events</h4>
      <div class="day-modal-list">
        ${evs.length ? evs.map(e => `<div class="row" style="background:#faf8fc;border:1px solid #ede6f2;border-radius:10px;padding:8px 10px;">🎉 ${escapeHtml(e.title)}
          <button class="icon-btn" style="float:right;color:var(--red);" data-action="delete-event" data-id="${e.id}" data-date="${dateStr}">✕</button></div>`).join('') : `<div class="empty-note">No events.</div>`}
      </div>
    </div>

    <div class="day-modal-section">
      <h4>Due</h4>
      <div class="day-modal-list">
        ${dues.length ? dues.map(t => `<div class="row" style="background:#faf8fc;border:1px solid #ede6f2;border-radius:10px;padding:8px 10px;">
          📌 ${escapeHtml(t.text)} ${t.classId?`<span class="row-tag">— ${escapeHtml(getClass(t.classId)?.name||'')}</span>`:''}
        </div>`).join('') : `<div class="empty-note">Nothing due.</div>`}
      </div>
    </div>

    <div class="day-modal-section">
      <h4>Classes meeting</h4>
      <div class="day-modal-list">
        ${classesOn.length ? classesOn.map(c => {
          const weekday = parseDateStr(dateStr).getDay();
          const todaysMeetings = (c.meetings||[]).filter(m => m.days && m.days[weekday]);
          const label = todaysMeetings.map(m => `${escapeHtml(m.label||'Class')}${m.time?' '+escapeHtml(m.time):''}`).join(', ');
          return `<div class="row" style="background:#faf8fc;border:1px solid #ede6f2;border-radius:10px;padding:8px 10px;">
          🎓 ${escapeHtml(c.name)} ${label?`<span class="row-tag">— ${label}</span>`:''}
          <button class="btn small ghost" style="float:right;" data-action="go-class-notes" data-id="${c.id}" data-date="${dateStr}">Open notes</button>
        </div>`;
        }).join('') : `<div class="empty-note">No classes meet this day.</div>`}
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn ghost" data-action="close-modal">Close</button>
    </div>
  `);
}

/* =========================================================
   EDIT CLASS DETAILS MODAL
   (creation itself happens inline in the sidebar — this modal
   is for filling in subtitle, meeting times, and links)
   ========================================================= */
function openEditClassModal(classId){
  const c = getClass(classId);
  if(!c) return;

  let editingLinks = (c.links||[]).map(l => ({...l}));
  if(editingLinks.length === 0) editingLinks.push({ label:'', url:'' });
  let editingMeetings = (c.meetings||[]).map(m => ({ ...m, days: [...(m.days||[false,false,false,false,false,false,false])] }));
  if(editingMeetings.length === 0) editingMeetings.push({ label:'', days:[false,false,false,false,false,false,false], time:'' });

  showModal(`
    <h3>Edit class details</h3>
    <form id="editClassForm">
      <div class="form-row">
        <label>Class name</label>
        <input type="text" name="name" value="${escapeHtml(c.name)}" required>
      </div>
      <div class="form-row">
        <label>Subtitle</label>
        <input type="text" name="subtitle" value="${escapeHtml(c.subtitle||'')}" placeholder="e.g. Embedded Systems I">
      </div>

      <div class="form-row">
        <label>Meeting times</label>
        <div id="meetingsContainer"></div>
        <button type="button" class="btn small ghost" id="addMeetingBtn">+ Add meeting time</button>
      </div>

      <div class="form-row">
        <label>Links</label>
        <div id="linksContainer"></div>
        <button type="button" class="btn small ghost" id="addLinkBtn">+ Add another link</button>
      </div>

      <div class="form-row">
        <label>Tab color</label>
        <input type="color" name="color" value="${c.color||'#e3a63f'}">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn gold">Save</button>
      </div>
    </form>
  `);

  function renderMeetingsRows(){
    const container = document.getElementById('meetingsContainer');
    container.innerHTML = editingMeetings.map((m,i) => `
      <div class="builder-row">
        <input type="text" class="meeting-label" data-idx="${i}" placeholder="e.g. Lecture, Lab" value="${escapeHtml(m.label||'')}">
        <div class="days-row">
          ${DOW_LABELS.map((l,d)=>`<button type="button" class="day-chip ${m.days[d]?'on':''}" data-idx="${i}" data-day="${d}">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]}</button>`).join('')}
        </div>
        <input type="time" class="meeting-time" data-idx="${i}" value="${escapeHtml(m.time||'')}">
        <span class="weekly-tag">Weekly</span>
        <button type="button" class="icon-btn remove-row-btn" data-idx="${i}" title="Remove">✕</button>
      </div>
    `).join('');
    container.querySelectorAll('.meeting-label').forEach(inp => inp.addEventListener('input', () => { editingMeetings[Number(inp.dataset.idx)].label = inp.value; }));
    container.querySelectorAll('.meeting-time').forEach(inp => inp.addEventListener('input', () => { editingMeetings[Number(inp.dataset.idx)].time = inp.value; }));
    container.querySelectorAll('.day-chip').forEach(chip => chip.addEventListener('click', () => {
      const i = Number(chip.dataset.idx), d = Number(chip.dataset.day);
      editingMeetings[i].days[d] = !editingMeetings[i].days[d];
      chip.classList.toggle('on');
    }));
    container.querySelectorAll('.remove-row-btn').forEach(btn => btn.addEventListener('click', () => {
      editingMeetings.splice(Number(btn.dataset.idx), 1);
      if(editingMeetings.length === 0) editingMeetings.push({ label:'', days:[false,false,false,false,false,false,false], time:'' });
      renderMeetingsRows();
    }));
  }

  function renderLinksRows(){
    const container = document.getElementById('linksContainer');
    container.innerHTML = editingLinks.map((l,i) => `
      <div class="builder-row">
        <input type="text" class="link-label" data-idx="${i}" placeholder="e.g. Website, Discord" value="${escapeHtml(l.label||'')}">
        <input type="url" class="link-url" data-idx="${i}" placeholder="https://..." value="${escapeHtml(l.url||'')}">
        <button type="button" class="icon-btn remove-row-btn" data-idx="${i}" title="Remove">✕</button>
      </div>
    `).join('');
    container.querySelectorAll('.link-label').forEach(inp => inp.addEventListener('input', () => { editingLinks[Number(inp.dataset.idx)].label = inp.value; }));
    container.querySelectorAll('.link-url').forEach(inp => inp.addEventListener('input', () => { editingLinks[Number(inp.dataset.idx)].url = inp.value; }));
    container.querySelectorAll('.remove-row-btn').forEach(btn => btn.addEventListener('click', () => {
      editingLinks.splice(Number(btn.dataset.idx), 1);
      if(editingLinks.length === 0) editingLinks.push({ label:'', url:'' });
      renderLinksRows();
    }));
  }

  renderMeetingsRows();
  renderLinksRows();
  document.getElementById('addMeetingBtn').addEventListener('click', () => {
    editingMeetings.push({ label:'', days:[false,false,false,false,false,false,false], time:'' });
    renderMeetingsRows();
  });
  document.getElementById('addLinkBtn').addEventListener('click', () => {
    editingLinks.push({ label:'', url:'' });
    renderLinksRows();
  });

  document.getElementById('editClassForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    c.name = fd.get('name').trim() || c.name;
    c.subtitle = fd.get('subtitle').trim();
    c.color = fd.get('color');
    c.meetings = editingMeetings
      .filter(m => (m.label && m.label.trim()) || m.days.some(Boolean) || m.time)
      .map(m => ({ label: (m.label||'').trim(), days: m.days, time: m.time||'' }));
    c.links = editingLinks
      .filter(l => l.url && l.url.trim())
      .map(l => ({ label: (l.label||'').trim() || 'Link', url: l.url.trim() }));
    saveState();
    closeModal();
    render();
  });
}

/* =========================================================
   EDIT TODO MODAL
   ========================================================= */
function openEditTodoModal(todoId){
  const t = state.todos.find(x => x.id === todoId);
  if(!t) return;
  const links = (t.links && t.links.length) ? t.links : (t.link ? [t.link] : []);

  showModal(`
    <h3>Edit task</h3>
    <form id="editTodoForm">
      <div class="form-row">
        <label>Assignment name</label>
        <input type="text" name="text" value="${escapeHtml(t.text)}" required>
      </div>
      <div class="form-row">
        <label>Due date</label>
        <input type="date" name="dueDate" value="${t.dueDate||''}">
      </div>
      <div class="form-row">
        <label>Links</label>
        ${linkInputsHtml('editTodoLinks', links)}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn gold">Save</button>
      </div>
    </form>
  `);

  wireLinkInputs('editTodoLinks');

  document.getElementById('editTodoForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    t.text = fd.get('text').trim() || t.text;
    t.dueDate = fd.get('dueDate') || '';
    t.links = collectLinkInputs('editTodoLinks');
    saveState();
    closeModal();
    render();
  });
}

/* =========================================================
   ADD EVENT MODAL
   ========================================================= */
function openAddEventModal(){
  showModal(`
    <h3>Add an event</h3>
    <form id="addEventForm">
      <div class="form-row">
        <label>Title</label>
        <input type="text" name="title" placeholder="e.g. GBM, Retreat, Food Fest" required>
      </div>
      <div class="form-row">
        <label>Date</label>
        <input type="date" name="date" value="${todayStr()}" required>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn gold">Add event</button>
      </div>
    </form>
  `);
  document.getElementById('addEventForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.events.push({ id: uid(), title: fd.get('title').trim(), date: fd.get('date') });
    saveState();
    closeModal();
    render();
  });
}

/* =========================================================
   MODAL / CONTEXT MENU PLUMBING
   ========================================================= */
function showModal(html){
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal(){
  document.getElementById('modalOverlay').classList.add('hidden');
}

let pendingTodoId = null;
function showContextMenu(x, y, todoId){
  pendingTodoId = todoId;
  const menu = document.getElementById('contextMenu');
  menu.classList.remove('hidden');
  // clamp so the menu never renders off-screen (matters most on mobile)
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';
}
function hideContextMenu(){
  document.getElementById('contextMenu').classList.add('hidden');
  pendingTodoId = null;
}

/* =========================================================
   MASTER RENDER
   ========================================================= */
function render(){
  renderSidebar();
  if(ui.view === 'class' && ui.classId){ renderClass(ui.classId); }
  else { ui.view = 'home'; renderHome(); }
}

/* =========================================================
   GLOBAL EVENT DELEGATION
   (one set of listeners handles the whole re-rendered app)
   ========================================================= */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');

  // click outside modal closes it
  if(e.target.id === 'modalOverlay'){ closeModal(); }
  // click anywhere closes context menu (unless clicking its own button)
  if(!e.target.closest('#contextMenu')){ hideContextMenu(); }

  if(!el) return;
  const action = el.dataset.action;

  switch(action){
    case 'go-class':
      ui.view = 'class'; ui.classId = el.dataset.id; render(); break;

    case 'delete-class': {
      const c = getClass(el.dataset.id);
      if(c && confirm(`Delete "${c.name}" and all its to-dos and notes?`)){
        state.classes = state.classes.filter(x => x.id !== el.dataset.id);
        state.todos = state.todos.filter(t => t.classId !== el.dataset.id);
        state.notes = state.notes.filter(n => n.classId !== el.dataset.id);
        if(ui.classId === el.dataset.id){ ui.view='home'; ui.classId=null; }
        saveState(); render();
      }
      break;
    }

    case 'toggle-todo': {
      const t = state.todos.find(x => x.id === el.dataset.id);
      if(t){ t.done = !t.done; saveState(); render(); }
      break;
    }

    case 'toggle-collapse':
      ui.collapsed[el.dataset.id] = !ui.collapsed[el.dataset.id];
      render();
      break;

    case 'toggle-minical':
      ui.miniCalCollapsed[el.dataset.id] = !ui.miniCalCollapsed[el.dataset.id];
      renderClass(el.dataset.id);
      break;

    case 'open-add-event': openAddEventModal(); break;
    case 'delete-event': {
      state.events = state.events.filter(x => x.id !== el.dataset.id);
      saveState();
      render();
      openDayModal(el.dataset.date); // refresh modal with updated list
      break;
    }

    case 'open-day': openDayModal(el.dataset.date); break;

    case 'mini-cal-pick': {
      const cid = el.dataset.classid;
      ui.notesDate[cid] = el.dataset.date;
      renderClass(cid);
      break;
    }

    case 'go-class-notes':
      ui.view = 'class'; ui.classId = el.dataset.id;
      ui.notesDate[el.dataset.id] = el.dataset.date;
      closeModal();
      render();
      break;

    case 'flip-notes-cal':
      state.settings.notesCalSide = state.settings.notesCalSide === 'left' ? 'right' : 'left';
      saveState();
      render();
      break;

    case 'home-cal-prev':
      ui.homeCal.month--; if(ui.homeCal.month<0){ ui.homeCal.month=11; ui.homeCal.year--; }
      render();
      break;
    case 'home-cal-next':
      ui.homeCal.month++; if(ui.homeCal.month>11){ ui.homeCal.month=0; ui.homeCal.year++; }
      render();
      break;

    case 'mini-cal-prev': {
      const cid = el.dataset.classid;
      const cur = ui.classCal[cid];
      cur.month--; if(cur.month<0){ cur.month=11; cur.year--; }
      renderClass(cid);
      break;
    }
    case 'mini-cal-next': {
      const cid = el.dataset.classid;
      const cur = ui.classCal[cid];
      cur.month++; if(cur.month>11){ cur.month=0; cur.year++; }
      renderClass(cid);
      break;
    }

    case 'edit-class': openEditClassModal(el.dataset.id); break;

    case 'close-modal': closeModal(); break;
  }
});

// right-click on a class tab -> rename it inline; right-click on a todo item -> edit/delete menu
document.addEventListener('contextmenu', e => {
  const classRow = e.target.closest('.class-nav-row');
  if(classRow && classRow.dataset.id){
    e.preventDefault();
    ui.renamingClassId = classRow.dataset.id;
    render();
    return;
  }
  const item = e.target.closest('.todo-item');
  if(item){
    e.preventDefault();
    showContextMenu(e.pageX, e.pageY, item.dataset.id);
  }
});

// long-press on a todo item -> same edit/delete menu, for mobile/touch
let longPressTimer = null;
let longPressFired = false;
document.addEventListener('touchstart', e => {
  const item = e.target.closest('.todo-item');
  if(!item) return;
  const touch = e.touches[0];
  longPressFired = false;
  longPressTimer = setTimeout(() => {
    longPressFired = true;
    showContextMenu(touch.pageX, touch.pageY, item.dataset.id);
  }, 500);
}, { passive: true });
document.addEventListener('touchmove', () => clearTimeout(longPressTimer));
document.addEventListener('touchend', e => {
  clearTimeout(longPressTimer);
  if(longPressFired){ e.preventDefault(); longPressFired = false; } // swallow the click that follows the long-press
});

// drag-and-drop reordering of class tabs
document.addEventListener('dragstart', e => {
  const row = e.target.closest('.class-nav-row');
  if(row && row.dataset.id){
    e.dataTransfer.setData('text/plain', row.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  }
});
document.addEventListener('dragend', e => {
  const row = e.target.closest('.class-nav-row');
  if(row) row.classList.remove('dragging');
});
document.addEventListener('dragover', e => {
  const row = e.target.closest('.class-nav-row');
  if(row && row.dataset.id){ e.preventDefault(); row.classList.add('drag-over'); }
});
document.addEventListener('dragleave', e => {
  const row = e.target.closest('.class-nav-row');
  if(row) row.classList.remove('drag-over');
});
document.addEventListener('drop', e => {
  const row = e.target.closest('.class-nav-row');
  if(row && row.dataset.id){
    e.preventDefault();
    row.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/plain');
    moveClass(draggedId, row.dataset.id);
  }
});
document.getElementById('ctxEdit').addEventListener('click', () => {
  const id = pendingTodoId;
  hideContextMenu();
  if(id) openEditTodoModal(id);
});
document.getElementById('ctxDelete').addEventListener('click', () => {
  if(pendingTodoId){
    state.todos = state.todos.filter(t => t.id !== pendingTodoId);
    saveState();
  }
  hideContextMenu();
  render();
});

document.getElementById('homeNavBtn').addEventListener('click', () => { ui.view='home'; render(); });
document.getElementById('addClassBtn').addEventListener('click', () => { ui.addingClass = true; render(); });

/* ---------------------------------------------------------
   INIT
   Rendering starts once firebase.auth().onAuthStateChanged
   (above) fires and either shows the app or the sign-in screen.
   --------------------------------------------------------- */
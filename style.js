/* =========================================================
   SCHOO — app logic
   Everything lives in localStorage under STORAGE_KEY, so all
   your classes / to-dos / notes stay on this device between visits.
   ========================================================= */

const STORAGE_KEY = 'schoo_notes_app_v1';
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS  = ['S','M','T','W','T','F','S'];

/* ---------------------------------------------------------
   STATE
   --------------------------------------------------------- */
let state = loadState();

// transient UI state (not persisted)
let ui = {
  view: 'home',        // 'home' | 'class'
  classId: null,
  collapsed: {},        // classId -> bool (todo panel collapsed)
  homeCal: currentMonthCursor(),
  classCal: {},          // classId -> {year,month}
  notesDate: {},         // classId -> 'YYYY-MM-DD'
};

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){ console.warn('Could not read saved data, starting fresh.', e); }
  return { classes: [], todos: [], events: [], notes: [], settings: { notesCalSide: 'right' } };
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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
  return state.classes.filter(c => c.days && c.days[weekday]);
}

/* =========================================================
   RENDER: SIDEBAR
   ========================================================= */
function renderSidebar(){
  const list = document.getElementById('classNavList');
  const homeBtn = document.getElementById('homeNavBtn');
  homeBtn.classList.toggle('active', ui.view === 'home');

  list.innerHTML = state.classes.map(c => `
    <div class="class-nav-row">
      <button class="nav-item ${ui.view==='class' && ui.classId===c.id ? 'active':''}" data-action="go-class" data-id="${c.id}">
        <span class="nav-dot" style="background:${c.color||'#cdb9dc'}"></span>
        ${escapeHtml(c.name)}
      </button>
      <button class="class-nav-del" title="Delete class" data-action="delete-class" data-id="${c.id}">✕</button>
    </div>
  `).join('');
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
            ${classesToday.length===0 ? `<div class="empty-note">No classes marked for today.</div>` : classesToday.map(c => `<div class="row">🎓 ${escapeHtml(c.name)} ${c.lectureInfo?`<span class="row-tag">— ${escapeHtml(c.lectureInfo)}</span>`:''}</div>`).join('')}
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
  const todos = classTodos(classId).sort((a,b) => (a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  const side = (state.settings.notesCalSide === 'left') ? 'flip' : '';

  content.innerHTML = `
    <div class="page-header">
      <h1>${escapeHtml(c.name)}</h1>
      <div class="sub">
        ${c.subtitle ? escapeHtml(c.subtitle)+' · ' : ''}${c.lectureInfo ? escapeHtml(c.lectureInfo) : ''}
        ${c.website ? ` · <a href="${escapeHtml(c.website)}" target="_blank" rel="noopener">Website</a>`:''}
        ${c.discord ? ` · <a href="${escapeHtml(c.discord)}" target="_blank" rel="noopener">Discord</a>`:''}
      </div>
    </div>

    <!-- STICKY COLLAPSIBLE TODO -->
    <section class="panel sticky-todo ${collapsed?'collapsed':''}" id="classTodoPanel">
      <div class="panel-header">
        <h3>To-do for ${escapeHtml(c.name)}</h3>
        <button class="icon-btn" data-action="toggle-collapse" data-id="${classId}">${collapsed ? '▸ Expand' : '▾ Collapse'}</button>
      </div>
      <form class="todo-add-row" id="classTodoForm">
        <input class="t-text" type="text" name="text" placeholder="Assignment name..." required>
        <input class="t-date" type="date" name="dueDate">
        <input class="t-link" type="url" name="link" placeholder="Link (optional)">
        <button class="btn gold" type="submit">Add</button>
      </form>
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
          </div>
          <div class="notes-editable" id="notesEditable" contenteditable="true" data-placeholder="Start typing today's notes...">${(findNote(classId, ui.notesDate[classId])||{}).html || ''}</div>
          <div class="autosave-tag" id="autosaveTag">saved</div>
        </div>
        <div class="notes-side">
          <div class="panel-header">
            <h3 style="font-size:14px;">Jump to a date</h3>
            <div class="cal-nav">
              <button class="icon-btn" data-action="mini-cal-prev" data-classid="${classId}">←</button>
              <span style="font-size:12.5px;font-weight:600;">${MONTH_NAMES[ui.classCal[classId].month]} ${ui.classCal[classId].year}</span>
              <button class="icon-btn" data-action="mini-cal-next" data-classid="${classId}">→</button>
            </div>
          </div>
          <div id="miniCalWrap" class="mini-cal">
            ${calendarHtml(ui.classCal[classId].year, ui.classCal[classId].month, { small:true, todayStr: todayStr(), selected: ui.notesDate[classId], classId })}
          </div>
        </div>
      </div>
    </section>
  `;

  document.getElementById('classTodoForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const text = fd.get('text').trim();
    if(!text) return;
    state.todos.push({ id: uid(), classId, text, dueDate: fd.get('dueDate')||'', link: fd.get('link')||'', done:false });
    saveState();
    render();
  });

  // notes date picker
  document.getElementById('notesDateInput').addEventListener('change', e => {
    ui.notesDate[classId] = e.target.value || todayStr();
    renderClass(classId); // safe to fully re-render on explicit date change
  });

  // toolbar formatting commands
  document.querySelectorAll('.toolbar [data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault()); // keep focus/selection in editor
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      document.getElementById('notesEditable').focus();
    });
  });

  // notes autosave (debounced), does NOT trigger full re-render
  const editable = document.getElementById('notesEditable');
  let saveTimer = null;
  editable.addEventListener('input', () => {
    const tag = document.getElementById('autosaveTag');
    tag.textContent = 'saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const dateStr = ui.notesDate[classId];
      let note = findNote(classId, dateStr);
      if(!note){ note = { id: uid(), classId, date: dateStr, html: '' }; state.notes.push(note); }
      note.html = editable.innerHTML;
      saveState();
      tag.textContent = 'saved ✓';
      refreshMiniCal(classId);
    }, 500);
  });
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
  return `
    <div class="todo-item ${t.done?'done':''}" data-id="${t.id}" data-action-context="todo">
      <button class="check-btn" data-action="toggle-todo" data-id="${t.id}">✓</button>
      <div class="t-body">
        <div class="t-text">${escapeHtml(t.text)}</div>
        <div class="t-meta">
          ${t.dueDate ? `<span>Due ${niceDate(t.dueDate)}</span>` : ''}
          ${t.link ? `<a href="${escapeHtml(t.link)}" target="_blank" rel="noopener">Open link ↗</a>` : ''}
          ${showClassTag && cls ? `<span class="t-class-tag">${escapeHtml(cls.name)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
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
        ${classesOn.length ? classesOn.map(c => `<div class="row" style="background:#faf8fc;border:1px solid #ede6f2;border-radius:10px;padding:8px 10px;">
          🎓 ${escapeHtml(c.name)}
          <button class="btn small ghost" style="float:right;" data-action="go-class-notes" data-id="${c.id}" data-date="${dateStr}">Open notes</button>
        </div>`).join('') : `<div class="empty-note">No classes meet this day.</div>`}
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn ghost" data-action="close-modal">Close</button>
    </div>
  `);
}

/* =========================================================
   ADD CLASS MODAL
   ========================================================= */
function openAddClassModal(){
  showModal(`
    <h3>Add a class</h3>
    <form id="addClassForm">
      <div class="form-row">
        <label>Class name</label>
        <input type="text" name="name" placeholder="e.g. CPRE 2880" required>
      </div>
      <div class="form-row">
        <label>Subtitle</label>
        <input type="text" name="subtitle" placeholder="e.g. Embedded Systems I">
      </div>
      <div class="form-row">
        <label>Lecture / lab info</label>
        <input type="text" name="lectureInfo" placeholder="e.g. TR 2:10–3:25, Lab W 12:05–2:00">
      </div>
      <div class="form-row">
        <label>Meets on</label>
        <div class="days-row" id="dayChips">
          ${DOW_LABELS.map((l,i)=>`<button type="button" class="day-chip" data-day="${i}">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}</button>`).join('')}
        </div>
      </div>
      <div class="form-row">
        <label>Website (optional)</label>
        <input type="url" name="website" placeholder="https://...">
      </div>
      <div class="form-row">
        <label>Discord (optional)</label>
        <input type="url" name="discord" placeholder="https://discord.gg/...">
      </div>
      <div class="form-row">
        <label>Tab color</label>
        <input type="color" name="color" value="#e3a63f">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn gold">Add class</button>
      </div>
    </form>
  `);

  const selectedDays = new Set();
  document.querySelectorAll('#dayChips .day-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const d = Number(chip.dataset.day);
      if(selectedDays.has(d)){ selectedDays.delete(d); chip.classList.remove('on'); }
      else { selectedDays.add(d); chip.classList.add('on'); }
    });
  });

  document.getElementById('addClassForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const days = [false,false,false,false,false,false,false];
    selectedDays.forEach(d => days[d] = true);
    const newClass = {
      id: uid(),
      name: fd.get('name').trim(),
      subtitle: fd.get('subtitle').trim(),
      lectureInfo: fd.get('lectureInfo').trim(),
      website: fd.get('website').trim(),
      discord: fd.get('discord').trim(),
      color: fd.get('color'),
      days
    };
    state.classes.push(newClass);
    saveState();
    closeModal();
    ui.view = 'class'; ui.classId = newClass.id;
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

let pendingDeleteTodoId = null;
function showContextMenu(x, y, todoId){
  pendingDeleteTodoId = todoId;
  const menu = document.getElementById('contextMenu');
  menu.style.left = x+'px';
  menu.style.top = y+'px';
  menu.classList.remove('hidden');
}
function hideContextMenu(){
  document.getElementById('contextMenu').classList.add('hidden');
  pendingDeleteTodoId = null;
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

    case 'close-modal': closeModal(); break;
  }
});

// right-click on a todo item -> custom delete context menu
document.addEventListener('contextmenu', e => {
  const item = e.target.closest('.todo-item');
  if(item){
    e.preventDefault();
    showContextMenu(e.pageX, e.pageY, item.dataset.id);
  }
});
document.getElementById('ctxDelete').addEventListener('click', () => {
  if(pendingDeleteTodoId){
    state.todos = state.todos.filter(t => t.id !== pendingDeleteTodoId);
    saveState();
  }
  hideContextMenu();
  render();
});

document.getElementById('homeNavBtn').addEventListener('click', () => { ui.view='home'; render(); });
document.getElementById('addClassBtn').addEventListener('click', openAddClassModal);

/* ---------------------------------------------------------
   INIT
   --------------------------------------------------------- */
render();
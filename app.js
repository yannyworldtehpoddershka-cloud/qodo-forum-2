/* Qodo Forum - локальное SPA без бэкенда
   Функции:
   - Регистрация, вход, выход (LocalStorage)
   - Темы, вопросы, ответы (CRUD)
   - Поиск, сортировка, фильтр по теме
   - Онбординг / обучение для новых пользователей
*/

// -------------------- Хранилище --------------------
const storage = {
  get(key, fallback){
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value){ localStorage.setItem(key, JSON.stringify(value)); },
  del(key){ localStorage.removeItem(key); }
};

const KEYS = {
  users: 'qf_users',
  session: 'qf_session',
  topics: 'qf_topics',
  questions: 'qf_questions',
  onboarding: 'qf_onboarding_hide',
};

// -------------------- Модель --------------------
function uid(prefix='id'){ return prefix + '_' + Math.random().toString(36).slice(2, 10); }
function now(){ return new Date().toISOString(); }

// Пользователи: { id, username, passwordHash, createdAt }
// Примитивный hash для демонстрации (не использовать в продакшене)
function simpleHash(s){
  let h = 0; for (let i=0;i<s.length;i++){ h = (h<<5)-h + s.charCodeAt(i); h|=0; }
  return 'h'+(h>>>0).toString(16);
}

const db = {
  users: storage.get(KEYS.users, []),
  topics: storage.get(KEYS.topics, []),
  questions: storage.get(KEYS.questions, []),
};

function saveDb(){
  storage.set(KEYS.users, db.users);
  storage.set(KEYS.topics, db.topics);
  storage.set(KEYS.questions, db.questions);
}

function getSession(){ return storage.get(KEYS.session, null); }
function setSession(sess){ storage.set(KEYS.session, sess); }
function clearSession(){ storage.del(KEYS.session); }

// -------------------- Инициализация демо-данных --------------------
(function seed(){
  if (db.topics.length === 0){
    db.topics = [
      { id: uid('t'), title: 'JavaScript', color: '#8aa2ff', createdAt: now() },
      { id: uid('t'), title: 'Python', color: '#00d1b2', createdAt: now() },
      { id: uid('t'), title: 'Web', color: '#f6c945', createdAt: now() },
    ];
  }
  if (db.users.length === 0){
    db.users = [
      { id: uid('u'), username:'demo', passwordHash: simpleHash('demo1234'), createdAt: now() },
    ];
  }
  if (db.questions.length === 0){
    const tWeb = db.topics.find(t=>t.title==='Web').id;
    db.questions = [
      { id: uid('q'), title:'Как подключить CSS к HTML?', body:'Подскажите базовый способ подключения CSS к HTML странице.', topicId:tWeb, author:'demo', createdAt: now(), replies:[
        { id: uid('r'), body:'Используйте тег <link rel="stylesheet" href="style.css"> в секции <head>.', author:'demo', createdAt: now() }
      ]}
    ];
  }
  saveDb();
})();

// -------------------- Утилиты UI --------------------
function el(html){
  const t = document.createElement('template'); t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
function timeAgo(iso){
  const d = new Date(iso); const diff = (Date.now() - d.getTime())/1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return Math.floor(diff/60)+' мин назад';
  if (diff < 86400) return Math.floor(diff/3600)+' ч назад';
  return d.toLocaleString();
}

function userChip(username){
  const initials = esc(String(username||'?').slice(0,2).toUpperCase());
  return `<span class="user-chip"><span class="avatar">${initials}</span><span>${esc(username)}</span></span>`;
}

// -------------------- Рендерер --------------------
const appRoot = document.getElementById('app');
const userArea = document.getElementById('userArea');

function setView(node){
  appRoot.innerHTML = '';
  appRoot.appendChild(node);
  updateUserArea();
}

function updateUserArea(){
  const sess = getSession();
  if (!sess){
    userArea.innerHTML = `<div class="actions">
      <button class="btn-ghost" data-action="go-login">Войти</button>
      <button class="btn" data-action="go-register">Регистрация</button>
    </div>`;
  } else {
    userArea.innerHTML = `<div class="actions">
      <span class="badge">${userChip(sess.username)}</span>
      <button class="btn-ghost" data-action="logout">Выйти</button>
    </div>`;
  }
}

userArea.addEventListener('click', (e)=>{
  const btn = e.target.closest('button'); if(!btn) return;
  const act = btn.dataset.action;
  if (act==='go-login') renderAuth('login');
  if (act==='go-register') renderAuth('register');
  if (act==='logout'){ clearSession(); updateUserArea(); renderHome(); }
});

// -------------------- Вью: Главная --------------------
function renderHome(){
  // фильтры
  const state = { q:'', topic:'all', sort:'new' };

  const view = el(`<div class="grid">
    <section class="card">
      <div class="card-header">
        <div class="row grow">
          <input class="input grow" placeholder="Поиск по вопросам" value="${state.q}" />
          <select class="select" data-f="topic">
            <option value="all">Все темы</option>
            ${db.topics.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join('')}
          </select>
          <select class="select" data-f="sort">
            <option value="new">Сначала новые</option>
            <option value="old">Сначала старые</option>
            <option value="answers">По количеству ответов</option>
          </select>
        </div>
        <div class="actions">
          <button class="btn" data-action="new-question">Задать вопрос</button>
        </div>
      </div>
      <div class="card-body">
        <div class="list" id="questionList"></div>
      </div>
    </section>

    <aside class="card">
      <div class="card-header"><strong>Темы</strong><span class="meta">(${db.topics.length})</span></div>
      <div class="card-body" id="topicList"></div>
      <div class="card-footer actions">
        <button class="btn-ghost" data-action="new-topic">Новая тема</button>
        <span class="right small muted">Подсказка: темы помогают фильтровать вопросы.</span>
      </div>
    </aside>
  </div>`);

  const qInput = view.querySelector('input.input');
  const topicSel = view.querySelector('select[data-f="topic"]');
  const sortSel = view.querySelector('select[data-f="sort"]');
  const listEl = view.querySelector('#questionList');
  const topicListEl = view.querySelector('#topicList');

  function renderTopics(){
    if (db.topics.length===0){ topicListEl.innerHTML = `<div class="empty">Тем пока нет.</div>`; return; }
    topicListEl.innerHTML = db.topics.map(t=>
      `<div class="item">
        <span class="topic"><span class="dot" style="background:${t.color}"></span>${esc(t.title)}</span>
        <span class="right meta">${db.questions.filter(q=>q.topicId===t.id).length} вопросов</span>
      </div>`
    ).join('');
  }

  function renderQuestions(){
    let qs = [...db.questions];
    if (state.q.trim()){
      const q = state.q.trim().toLowerCase();
      qs = qs.filter(x=>x.title.toLowerCase().includes(q) || x.body.toLowerCase().includes(q));
    }
    if (state.topic!=='all') qs = qs.filter(x=>x.topicId===state.topic);

    if (state.sort==='new') qs.sort((a,b)=> b.createdAt.localeCompare(a.createdAt));
    if (state.sort==='old') qs.sort((a,b)=> a.createdAt.localeCompare(b.createdAt));
    if (state.sort==='answers') qs.sort((a,b)=> (b.replies?.length||0)-(a.replies?.length||0));

    if (qs.length===0){ listEl.innerHTML = `<div class="empty">Ничего не найдено.</div>`; return; }

    listEl.innerHTML = qs.map(q=>
      `<div class="item">
        <div class="grow">
          <div class="row" style="align-items:center;gap:8px">
            <span class="topic"><span class="dot" style="background:${db.topics.find(t=>t.id===q.topicId)?.color||'#8aa2ff'}"></span>${esc(db.topics.find(t=>t.id===q.topicId)?.title||'Без темы')}</span>
            <a href="#" data-id="${q.id}" class="linkq" style="text-decoration:none;color:inherit"><strong>${esc(q.title)}</strong></a>
          </div>
          <div class="meta">Автор: ${userChip(q.author)} • ${timeAgo(q.createdAt)} • Ответов: ${q.replies?.length||0}</div>
        </div>
        <div class="actions">
          <button class="btn-ghost small" data-action="open" data-id="${q.id}">Открыть</button>
          <button class="btn-ghost small" data-action="edit-q" data-id="${q.id}">Изм.</button>
          <button class="btn-ghost small btn-danger" data-action="del-q" data-id="${q.id}">Удалить</button>
        </div>
      </div>`
    ).join('');
  }

  renderTopics();
  renderQuestions();

  // фильтры/поиск
  qInput.addEventListener('input', ()=>{ state.q=qInput.value; renderQuestions(); });
  topicSel.addEventListener('change', ()=>{ state.topic=topicSel.value; renderQuestions(); });
  sortSel.addEventListener('change', ()=>{ state.sort=sortSel.value; renderQuestions(); });

  // клики
  view.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    const link = e.target.closest('a.linkq');
    if (link){ e.preventDefault(); renderQuestion(link.dataset.id); return; }
    if (!btn) return; const act=btn.dataset.action; const id=btn.dataset.id;
    if (act==='new-question') renderQuestionEditor();
    if (act==='open') renderQuestion(id);
    if (act==='edit-q') renderQuestionEditor(id);
    if (act==='del-q') deleteQuestion(id, ()=>{ renderQuestions(); renderTopics(); });
    if (act==='new-topic') renderTopicEditor();
  });

  setView(view);
}

// -------------------- Вью: Авторизация --------------------
function renderAuth(tab='login'){
  const view = el(`<section class="auth-panel card">
    <div class="card-header">
      <div class="auth-toggle">
        <button class="btn-ghost ${tab==='login'?'active':''}" data-tab="login">Вход</button>
        <button class="btn-ghost ${tab==='register'?'active':''}" data-tab="register">Регистрация</button>
      </div>
    </div>
    <div class="card-body" id="authBody"></div>
  </section>`);

  const body = view.querySelector('#authBody');

  function renderLogin(){
    body.innerHTML = `<form class="column" id="loginForm">
      <div class="row">
        <input class="input" required placeholder="Логин" name="username" />
      </div>
      <div class="row">
        <input class="input" required placeholder="Пароль" name="password" type="password" />
      </div>
      <div class="actions">
        <button class="btn" type="submit">Войти</button>
        <span class="muted small">Демо: demo / demo1234</span>
      </div>
    </form>`;

    body.querySelector('#loginForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      const f = new FormData(e.target);
      const username = String(f.get('username')||'').trim();
      const password = String(f.get('password')||'');
      const u = db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
      if (!u || u.passwordHash!==simpleHash(password)) return toast('Неверный логин или пароль', 'error');
      setSession({ id:u.id, username:u.username });
      toast('Вы вошли в систему');
      renderHome();
    });
  }

  function renderRegister(){
    body.innerHTML = `<form class="column" id="regForm">
      <div class="row">
        <input class="input" required placeholder="Никнейм" name="username" minlength="3" />
      </div>
      <div class="row">
        <input class="input" required placeholder="Пароль (мин. 6 символов)" name="password" type="password" minlength="6" />
      </div>
      <div class="row">
        <input class="input" required placeholder="Повторите пароль" name="password2" type="password" minlength="6" />
      </div>
      <div class="actions">
        <button class="btn" type="submit">Создать аккаунт</button>
      </div>
    </form>`;

    body.querySelector('#regForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      const f = new FormData(e.target);
      const username = String(f.get('username')||'').trim();
      const password = String(f.get('password')||'');
      const password2 = String(f.get('password2')||'');
      if (password!==password2) return toast('Пароли не совпадают', 'error');
      if (db.users.some(u=>u.username.toLowerCase()===username.toLowerCase())) return toast('Такой ник уже зарегистрирован', 'error');
      const user = { id: uid('u'), username, passwordHash: simpleHash(password), createdAt: now() };
      db.users.push(user); saveDb();
      setSession({ id:user.id, username:user.username });
      toast('Аккаунт создан и вы вошли');
      renderHome();
    });
  }

  function rerender(){ tab==='login'?renderLogin():renderRegister(); }
  rerender();

  view.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click', ()=>{
    tab = b.dataset.tab; rerender(); updateTabs();
  }));

  function updateTabs(){
    const [a,b] = view.querySelectorAll('[data-tab]');
    a.classList.toggle('active', tab==='login');
    b.classList.toggle('active', tab==='register');
  }

  setView(view);
}

// -------------------- Вью: Редактор темы --------------------
function renderTopicEditor(topicId){
  const isEdit = Boolean(topicId);
  const t = isEdit ? db.topics.find(x=>x.id===topicId) : { title:'', color:'#8aa2ff' };
  const view = el(`<section class="card" style="max-width:560px;margin:0 auto">
    <div class="card-header"><strong>${isEdit?'Редактировать тему':'Новая тема'}</strong></div>
    <div class="card-body">
      <form id="topicForm">
        <div class="row">
          <input class="input grow" name="title" placeholder="Название темы" required value="${esc(t.title)}" />
          <input class="input" type="color" name="color" value="${t.color}" title="Цвет метки" />
        </div>
        <div class="actions">
          <button class="btn" type="submit">Сохранить</button>
          <button class="btn-ghost" type="button" data-action="cancel">Отмена</button>
          ${isEdit?`<button class="btn-ghost btn-danger right" type="button" data-action="delete">Удалить тему</button>`:''}
        </div>
      </form>
    </div>
  </section>`);

  view.querySelector('#topicForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const title = String(f.get('title')||'').trim();
    const color = String(f.get('color')||'#8aa2ff');
    if (!title) return toast('Введите название темы', 'error');
    if (isEdit){
      t.title = title; t.color = color;
    } else {
      db.topics.push({ id: uid('t'), title, color, createdAt: now() });
    }
    saveDb(); toast('Тема сохранена'); renderHome();
  });

  view.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const act = btn.dataset.action;
    if (act==='cancel') renderHome();
    if (act==='delete' && confirm('Удалить тему? Вопросы останутся без темы.')){
      const idx = db.topics.findIndex(x=>x.id===t.id); if (idx>=0) db.topics.splice(idx,1);
      db.questions.forEach(q=>{ if(q.topicId===t.id) q.topicId = db.topics[0]?.id || 'none'; });
      saveDb(); toast('Тема удалена'); renderHome();
    }
  });

  setView(view);
}

// -------------------- Вью: Редактор вопроса --------------------
function renderQuestionEditor(qid){
  const sess = getSession(); if(!sess){ toast('Требуется вход', 'error'); return renderAuth('login'); }
  const isEdit = Boolean(qid);
  const q = isEdit ? db.questions.find(x=>x.id===qid) : { title:'', body:'', topicId: db.topics[0]?.id };
  const view = el(`<section class="card">
    <div class="card-header"><strong>${isEdit?'Редактировать вопрос':'Новый вопрос'}</strong></div>
    <div class="card-body">
      <form id="qForm">
        <div class="row">
          <input class="input grow" name="title" placeholder="Короткий заголовок" required value="${esc(q.title)}" />
        </div>
        <div class="row">
          <select class="select" name="topicId">
            ${db.topics.map(t=>`<option value="${t.id}" ${q.topicId===t.id?'selected':''}>${esc(t.title)}</option>`).join('')}
          </select>
        </div>
        <div class="row">
          <textarea class="textarea" name="body" placeholder="Опишите проблему, ожидаемое и фактическое поведение, что уже пробовали" required>${esc(q.body)}</textarea>
        </div>
        <div class="actions">
          <button class="btn" type="submit">Сохранить</button>
          <button class="btn-ghost" type="button" data-action="cancel">Отмена</button>
        </div>
      </form>
    </div>
  </section>`);

  view.querySelector('#qForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    const f = new FormData(e.target);
    const title = String(f.get('title')||'').trim();
    const body = String(f.get('body')||'').trim();
    const topicId = String(f.get('topicId'));
    if (!title || !body) return toast('Заполните все поля', 'error');
    if (isEdit){
      q.title = title; q.body = body; q.topicId = topicId;
    } else {
      db.questions.push({ id: uid('q'), title, body, topicId, author:sess.username, createdAt: now(), replies: [] });
    }
    saveDb(); toast('Вопрос сохранен'); renderHome();
  });

  view.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    if (btn.dataset.action==='cancel') renderHome();
  });

  setView(view);
}

// -------------------- Вью: Страница вопроса --------------------
function renderQuestion(qid){
  const q = db.questions.find(x=>x.id===qid); if(!q){ toast('Вопрос не найден', 'error'); return renderHome(); }
  const sess = getSession();
  const view = el(`<section class="card">
    <div class="card-header">
      <div class="row" style="align-items:center">
        <span class="topic"><span class="dot" style="background:${db.topics.find(t=>t.id===q.topicId)?.color||'#8aa2ff'}"></span>${esc(db.topics.find(t=>t.id===q.topicId)?.title||'Без темы')}</span>
        <strong class="grow">${esc(q.title)}</strong>
      </div>
      <div class="actions">
        <button class="btn-ghost" data-action="edit">Редактировать</button>
        <button class="btn-ghost btn-danger" data-action="delete">Удалить</button>
      </div>
    </div>
    <div class="card-body">
      <div class="meta">Автор: ${userChip(q.author)} • ${timeAgo(q.createdAt)}</div>
      <div style="margin-top:8px">${linkify(esc(q.body))}</div>
    </div>
    <div class="card-footer">
      <strong>Ответы (${q.replies?.length||0})</strong>
    </div>
    <div class="card-body">
      <div class="list" id="replyList"></div>
    </div>
    <div class="card-footer">
      ${sess? replyFormHtml(): `<div class="muted small">Чтобы ответить, войдите в систему.</div>`}
    </div>
  </section>`);

  function replyFormHtml(){
    return `<form id="replyForm" class="column">
      <textarea class="textarea" name="body" required placeholder="Ваш ответ"></textarea>
      <div class="actions">
        <button class="btn" type="submit">Отправить</button>
      </div>
    </form>`;
  }

  function renderReplies(){
    const list = view.querySelector('#replyList');
    if (!q.replies || q.replies.length===0){ list.innerHTML = `<div class="empty">Ответов пока нет.</div>`; return; }
    list.innerHTML = q.replies.map(r=>
      `<div class="item">
        <div class="grow">
          <div class="meta">${userChip(r.author)} • ${timeAgo(r.createdAt)}</div>
          <div>${linkify(esc(r.body))}</div>
        </div>
        <div class="actions">
          ${sess && sess.username===r.author? `<button class="btn-ghost small" data-action="edit-rep" data-id="${r.id}">Изм.</button>
          <button class="btn-ghost small btn-danger" data-action="del-rep" data-id="${r.id}">Удалить</button>` : ''}
        </div>
      </div>`
    ).join('');
  }

  function submitReply(body){
    if (!sess) return toast('Войдите, чтобы отвечать', 'error');
    const reply = { id: uid('r'), body, author: sess.username, createdAt: now() };
    q.replies = q.replies || []; q.replies.push(reply); saveDb(); renderReplies(); toast('Ответ опубликован');
  }

  view.addEventListener('submit', (e)=>{
    if (e.target.id==='replyForm'){
      e.preventDefault();
      const f = new FormData(e.target);
      const body = String(f.get('body')||'').trim(); if(!body) return;
      submitReply(body); e.target.reset();
    }
  });

  view.addEventListener('click', (e)=>{
    const btn = e.target.closest('button'); if(!btn) return;
    const act = btn.dataset.action; const id = btn.dataset.id;
    if (act==='edit') renderQuestionEditor(q.id);
    if (act==='delete') deleteQuestion(q.id, ()=> renderHome());
    if (act==='del-rep'){
      const i = q.replies.findIndex(r=>r.id===id); if(i>=0){ q.replies.splice(i,1); saveDb(); renderReplies(); toast('Ответ удален'); }
    }
    if (act==='edit-rep'){
      const r = q.replies.find(r=>r.id===id); if(!r) return;
      const nv = prompt('Изменить ответ:', r.body); if(nv!==null){ r.body = nv; saveDb(); renderReplies(); toast('Ответ обновлен'); }
    }
  });

  renderReplies();
  setView(view);
}

function deleteQuestion(qid, ondone){
  if (!confirm('Удалить вопрос?')) return;
  const i = db.questions.findIndex(x=>x.id===qid); if (i>=0) db.questions.splice(i,1);
  saveDb(); toast('Вопрос удален'); if (ondone) ondone();
}

// -------------------- Обучение / Онбординг --------------------
const onboarding = {
  steps: [
    {
      title: 'Что это?',
      body: `Это локальный мини‑форум. Все данные сохраняются в LocalStorage вашего браузера.\n\nВы можете зарегистрироваться, создавать темы, задавать вопросы и оставлять ответы.`
    },
    {
      title: 'Быстрый старт',
      body: `1) Создайте аккаунт во вкладке Вход/Регистрация.\n2) Нажмите «Задать вопрос» на главной.\n3) Отфильтруйте вопросы по темам и используйте поиск.\n\nДемо аккаунт: \nлогин <span class="code">demo</span>, пароль <span class="code">demo1234</span>.`
    },
    {
      title: 'Ограничения',
      body: `Это демо без сервера: нет почт, ролей, загрузок. Для продакшена нужен бэкенд (например, Node/Express, Django, FastAPI) и база данных.`
    },
  ],
  index: 0,
  hidden: storage.get(KEYS.onboarding, false),
};

const onboardingEl = document.getElementById('onboarding');
const onboardingBodyEl = document.getElementById('onboardingBody');
const dontShowAgainEl = document.getElementById('dontShowAgain');
const onboardingPrevBtn = document.getElementById('onboardingPrev');
const onboardingNextBtn = document.getElementById('onboardingNext');
const onboardingCloseBtn = document.getElementById('onboardingClose');

function renderOnboarding(){
  if (onboarding.hidden) return;
  const step = onboarding.steps[onboarding.index];
  onboardingBodyEl.innerHTML = `<h3 style="margin:0 0 8px 0">${esc(step.title)}</h3><p>${step.body}</p>`;
  onboardingPrevBtn.disabled = onboarding.index===0;
  onboardingNextBtn.textContent = onboarding.index===onboarding.steps.length-1? 'Готово' : 'Далее';
  onboardingEl.classList.remove('hidden');
}

function closeOnboarding(){ onboardingEl.classList.add('hidden'); }

onboardingPrevBtn.addEventListener('click', ()=>{ if(onboarding.index>0){ onboarding.index--; renderOnboarding(); } });

onboardingNextBtn.addEventListener('click', ()=>{
  if (dontShowAgainEl.checked){ storage.set(KEYS.onboarding, true); }
  if (onboarding.index < onboarding.steps.length-1){ onboarding.index++; renderOnboarding(); } else { closeOnboarding(); }
});

onboardingCloseBtn.addEventListener('click', ()=>{ if (dontShowAgainEl.checked){ storage.set(KEYS.onboarding, true); } closeOnboarding(); });

document.getElementById('helpBtn').addEventListener('click', ()=>{ onboarding.hidden=false; onboarding.index=0; renderOnboarding(); });

// -------------------- Тосты --------------------
let toastTimer;
function toast(text, type='info'){
  const old = document.getElementById('toast'); if(old) old.remove();
  const bg = type==='error' ? 'linear-gradient(180deg,#ff6f8a,#ff5c7a)' : (type==='ok'?'linear-gradient(180deg,#11e3c3,#00d1b2)':'linear-gradient(180deg,#6c7bff,#8aa2ff)');
  const t = el(`<div id="toast" style="position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:9;background:${bg};color:#fff;padding:10px 14px;border-radius:10px;box-shadow:var(--shadow)">${esc(text)}</div>`);
  document.body.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(()=> t.remove(), 2600);
}

// -------------------- Ссылки в тексте --------------------
function linkify(text){
  const urlRe = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;
  return text.replace(urlRe, (m)=>{
    const url = m.startsWith('http')? m : 'http://'+m;
    return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(m)}</a>`;
  });
}

// -------------------- GitHub repo link check --------------------
const GITHUB_OWNER = 'yannyworldtehpoddershka-cloud';
const GITHUB_REPO = 'qodo-forum';
async function ensureRepoLink(){
  const link = document.querySelector('a.footer-link[href*="github.com/yannyworldtehpoddershka-cloud/qodo-forum"]');
  if (!link) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`);
    if (res.status === 404) {
      link.href = `https://github.com/${GITHUB_OWNER}`;
      link.textContent = 'GitHub (репозиторий не найден)';
      link.title = 'Откроется профиль: репозиторий не существует или приватный';
    }
  } catch (e) {
    // сеть недоступна или блокируется - оставляем ссылку как есть
  }
}

// -------------------- Маршрутизация (простая) --------------------
function routeFromHash(){
  const h = location.hash.slice(1);
  if (!h) return renderHome();
  const [page, id] = h.split('/');
  if (page==='login') return renderAuth('login');
  if (page==='register') return renderAuth('register');
  if (page==='q' && id) return renderQuestion(id);
  return renderHome();
}
window.addEventListener('hashchange', routeFromHash);

// -------------------- Старт --------------------
renderHome();
ensureRepoLink();
if (!onboarding.hidden) renderOnboarding();

const TOKEN_KEY = 'wunschzettel-token';

const app = document.getElementById('app');
let state = null;
let authMode = 'create';
let addFormOpen = false;

function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Fehler');
    return data;
  });
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function render() {
  if (!state) return renderAuth();
  renderGroup();
}

function renderAuth() {
  app.innerHTML = `
    <div class="container">
      <div class="card auth-card">
        <h1 style="margin-top:0">🎁 Wunschzettel</h1>
        <p class="muted">Gemeinsame Wunschlisten für deine Gruppe.</p>
        <div class="tabs">
          <div class="tab ${authMode === 'create' ? 'active' : ''}" id="tab-create">Gruppe erstellen</div>
          <div class="tab ${authMode === 'join' ? 'active' : ''}" id="tab-join">Gruppe beitreten</div>
        </div>
        ${authMode === 'create' ? `
          <label for="groupName">Name der Gruppe</label>
          <input type="text" id="groupName" placeholder="z. B. Familie, Weihnachten…" />
        ` : `
          <label for="inviteCode">Einladungscode</label>
          <input type="text" id="inviteCode" placeholder="z. B. A3BK7Q" style="text-transform:uppercase" />
        `}
        <label for="yourName">Dein Name</label>
        <input type="text" id="yourName" placeholder="z. B. Anna" />
        <button class="full" id="auth-go">${authMode === 'create' ? 'Gruppe erstellen' : 'Gruppe beitreten'}</button>
        <div class="error" id="auth-error"></div>
      </div>
    </div>
  `;
  document.getElementById('tab-create').onclick = () => { authMode = 'create'; render(); };
  document.getElementById('tab-join').onclick = () => { authMode = 'join'; render(); };
  document.getElementById('auth-go').onclick = doAuth;
  document.getElementById('yourName').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
  if (authMode === 'join') document.getElementById('inviteCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
}

async function doAuth() {
  const err = document.getElementById('auth-error');
  err.textContent = '';
  const yourName = document.getElementById('yourName').value.trim();
  try {
    let data;
    if (authMode === 'create') {
      const groupName = document.getElementById('groupName').value.trim();
      data = await api('/api/groups', { method: 'POST', body: { groupName, yourName } });
    } else {
      const inviteCode = document.getElementById('inviteCode').value.trim().toUpperCase();
      data = await api('/api/groups/join', { method: 'POST', body: { inviteCode, yourName } });
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    await refresh();
  } catch (e) {
    err.textContent = e.message;
  }
}

async function refresh() {
  state = await api('/api/state');
  render();
}

function renderGroup() {
  const { group, me, members, items } = state;
  const myItems = items.filter((i) => i.member_id === me.id);
  const others = members.filter((m) => m.id !== me.id);

  app.innerHTML = `
    <div class="container">
      <div class="topbar">
        <h1>🎁 ${esc(group.name)}</h1>
        <div>
          <span class="badge">${esc(me.name)}</span>
          <button class="secondary small" id="logout" style="margin-left:8px">Abmelden</button>
        </div>
      </div>

      <div class="card">
        <strong>Mitglieder einladen</strong>
        <div class="share-box" style="margin-top:10px">
          <span>Code:</span> <code>${esc(group.inviteCode)}</code>
          <button class="secondary small" id="copy-link">Link kopieren</button>
          <span class="muted">${esc(location.origin + '/?code=' + group.inviteCode)}</span>
        </div>
      </div>

      <div class="card member-section">
        <h2>Meine Wunschliste</h2>
        <p class="muted" style="font-size:0.9rem;margin:0 0 12px">Füge Links, Bilder oder eigene Ideen hinzu. Ob etwas reserviert oder gekauft wurde, bleibt für dich verdeckt.</p>
        <button class="secondary" id="toggle-add">＋ Item hinzufügen</button>
        <div class="add-form ${addFormOpen ? 'open' : ''}" id="add-form">
          <label for="f-title">Titel *</label>
          <input type="text" id="f-title" placeholder="z. B. Kopfhörer, Buch, Kaffee-Führung…" />
          <label for="f-url">Link (optional)</label>
          <input type="url" id="f-url" placeholder="https://…" />
          <label for="f-image-url">Bild-Link (optional)</label>
          <input type="url" id="f-image-url" placeholder="https://…/bild.jpg" />
          <label for="f-image-file">… oder Bild hochladen (optional)</label>
          <input type="file" id="f-image-file" accept="image/png,image/jpeg,image/webp,image/gif" />
          <div class="file-hint">PNG/JPG/WebP/GIF, max. 8 MB</div>
          <label for="f-notes">Notizen (optional)</label>
          <textarea id="f-notes" placeholder="z. B. Größe, Farbe, Alternativen…"></textarea>
          <button class="full" id="add-item">Hinzufügen</button>
          <div class="error" id="add-error"></div>
        </div>
        <div class="item-grid" id="my-items"></div>
      </div>

      ${others.map((m) => {
        const list = items.filter((i) => i.member_id === m.id);
        return `
          <div class="card member-section">
            <h2>Wunschliste von ${esc(m.name)}</h2>
            ${list.length ? '' : '<p class="muted" style="font-size:0.9rem">Noch keine Items.</p>'}
            <div class="item-grid">${list.map((i) => itemHtml(i, false)).join('')}</div>
          </div>`;
      }).join('')}
    </div>
  `;

  document.getElementById('logout').onclick = () => {
    localStorage.removeItem(TOKEN_KEY);
    state = null;
    render();
  };
  document.getElementById('copy-link').onclick = () => {
    navigator.clipboard.writeText(location.origin + '/?code=' + group.inviteCode);
    event.target.textContent = 'Kopiert ✓';
    setTimeout(() => (event.target.textContent = 'Link kopieren'), 1500);
  };
  document.getElementById('toggle-add').onclick = () => {
    addFormOpen = !addFormOpen;
    render();
  };
  document.getElementById('add-item').onclick = doAddItem;

  document.getElementById('my-items').innerHTML = myItems.map((i) => itemHtml(i, true)).join('');
  document.querySelectorAll('[data-action]').forEach(bindActions);
}

function statusHtml(item) {
  if (item.bought) {
    return `<div class="status-line status-bought">✓ Gekauft${item.bought_by_name ? ' (von ' + esc(item.bought_by_name) + ')' : ''}</div>`;
  }
  if (item.reserved) {
    return `<div class="status-line status-reserved">⏳ Reserviert${item.reserved_by_name ? ' (von ' + esc(item.reserved_by_name) + ')' : ''}</div>`;
  }
  return '';
}

function itemHtml(item, isOwn) {
  const cls = item.bought ? 'bought-state' : item.reserved ? 'reserved-state' : '';
  const image = item.image_url
    ? `<img src="${esc(item.image_url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '';
  const titleHtml = item.url
    ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
    : esc(item.title);
  let actions = '';
  if (isOwn) {
    actions = `
      <div class="item-actions">
        <span class="spacer"></span>
        <button class="danger" data-action="delete" data-id="${item.id}">Löschen</button>
      </div>`;
  } else {
    const mine = item.reserved_by === state.me.id || (item.bought && item.bought_by === state.me.id);
    if (item.bought) {
      actions = mine
        ? `<div class="item-actions"><span class="spacer"></span><button class="secondary small" data-action="unbought" data-id="${item.id}">Als gekauft zurücknehmen</button></div>`
        : '';
    } else if (item.reserved) {
      actions = mine
        ? `<div class="item-actions"><span class="spacer"></span><button class="green small" data-action="bought" data-id="${item.id}">Gekauft ✓</button><button class="secondary small" data-action="unreserve" data-id="${item.id}">Reservierung aufheben</button></div>`
        : '';
    } else {
      actions = `
        <div class="item-actions">
          <span class="spacer"></span>
          <button class="small" data-action="reserve" data-id="${item.id}">Reservieren</button>
          <button class="green small" data-action="bought" data-id="${item.id}">Direkt gekauft ✓</button>
        </div>`;
    }
  }
  return `
    <div class="item ${cls}">
      ${image}
      <div class="item-body">
        <p class="item-title">${titleHtml}</p>
        ${item.notes ? `<p class="item-notes">${esc(item.notes)}</p>` : ''}
        ${statusHtml(item)}
        ${actions}
      </div>
    </div>`;
}

function bindActions(el) {
  el.onclick = async () => {
    const id = el.dataset.id;
    const action = el.dataset.action;
    try {
      if (action === 'delete') {
        state = await api('/api/items/' + id, { method: 'DELETE' });
      } else {
        state = await api('/api/items/' + id + '/' + action, { method: 'POST' });
      }
      render();
    } catch (e) {
      alert(e.message);
    }
  };
}

async function doAddItem() {
  const err = document.getElementById('add-error');
  err.textContent = '';
  const title = document.getElementById('f-title').value.trim();
  if (!title) { err.textContent = 'Bitte einen Titel angeben.'; return; }
  const btn = document.getElementById('add-item');
  btn.disabled = true;
  try {
    let imageUrl = document.getElementById('f-image-url').value.trim();
    const file = document.getElementById('f-image-file').files[0];
    if (file) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const up = await api('/api/upload', { method: 'POST', body: { dataUrl } });
      imageUrl = up.imageUrl;
    }
    state = await api('/api/items', {
      method: 'POST',
      body: {
        title,
        url: document.getElementById('f-url').value.trim(),
        imageUrl,
        notes: document.getElementById('f-notes').value.trim(),
      },
    });
    addFormOpen = false;
    render();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code && !localStorage.getItem(TOKEN_KEY)) {
    authMode = 'join';
    render();
    document.getElementById('inviteCode').value = code.toUpperCase();
    return;
  }
  if (localStorage.getItem(TOKEN_KEY)) {
    try {
      await refresh();
      return;
    } catch {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  render();
}

boot();

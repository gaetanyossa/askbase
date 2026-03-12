const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// -- Nav --
$$('.nav-item').forEach(n => n.addEventListener('click', () => {
    $$('.nav-item').forEach(x => x.classList.remove('active'));
    n.classList.add('active');
    const tab = n.dataset.tab;
    $$('.panel').forEach(x => x.classList.remove('active'));
    $$('.chat-panel').forEach(x => x.classList.remove('active'));
    const target = $('#p-' + tab);
    if (target) target.classList.add('active');
}));

function switchNav(name) {
    $$('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    $$('.panel').forEach(x => x.classList.remove('active'));
    $$('.chat-panel').forEach(x => x.classList.remove('active'));
    const target = $('#p-' + name);
    if (target) target.classList.add('active');
}

// -- DB type toggle --
let dbType = 'bigquery';
$$('#db-radios input').forEach(r => r.addEventListener('change', () => {
    dbType = r.value;
    $('#bq-fields').style.display = dbType === 'bigquery' ? '' : 'none';
    $('#sql-fields').style.display = (dbType === 'mysql' || dbType === 'postgresql') ? '' : 'none';
    $('#sqlite-fields').style.display = dbType === 'sqlite' ? '' : 'none';
}));

// -- LLM provider toggle --
let llmProvider = 'openai';
$$('#llm-radios input').forEach(r => r.addEventListener('change', () => {
    llmProvider = r.value;
}));

// -- File upload --
const drop = $('#file-drop');
const fileInput = $('#file-input');
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

async function handleFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    setStatus('bq-status', 'idle', 'Uploading...');
    try {
        const r = await fetch('/api/upload-credentials', { method: 'POST', body: fd });
        const d = await r.json();
        if (d.ok) {
            drop.textContent = file.name;
            drop.classList.add('uploaded');
            if (d.project_id) $('#bq-project').value = d.project_id;
            setStatus('bq-status', 'ok', d.datasets.length + ' dataset(s) found');
            const sel = $('#bq-dataset');
            sel.innerHTML = d.datasets.map(ds => '<option value="'+ds+'">'+ds+'</option>').join('');
        } else {
            setStatus('bq-status', 'err', d.error);
        }
    } catch(e) { setStatus('bq-status', 'err', e.message); }
}

function setStatus(id, kind, text) {
    const el = $('#' + id);
    el.className = 'status ' + kind;
    el.innerHTML = '<span class="dot"></span>' + text;
}

// -- Encrypted localStorage --
const STORE_KEY = 'askbase_config';
const ENC_ALGO = 'AES-GCM';

async function getCryptoKey() {
    const raw = new TextEncoder().encode('AskBase-Local-Key-2024!'.padEnd(32, '0').slice(0, 32));
    return crypto.subtle.importKey('raw', raw, ENC_ALGO, false, ['encrypt', 'decrypt']);
}

async function encryptAndStore(data) {
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const encrypted = await crypto.subtle.encrypt({ name: ENC_ALGO, iv }, key, encoded);
    const payload = { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
    localStorage.setItem(STORE_KEY, JSON.stringify(payload));
}

async function decryptFromStore() {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    try {
        const { iv, data } = JSON.parse(raw);
        const key = await getCryptoKey();
        const decrypted = await crypto.subtle.decrypt(
            { name: ENC_ALGO, iv: new Uint8Array(iv) },
            key,
            new Uint8Array(data)
        );
        return JSON.parse(new TextDecoder().decode(decrypted));
    } catch { return null; }
}

// =====================================================
// Multi-conversation system
// =====================================================

// conversations = { id: { title: "...", messages: [{role, text}] } }
let conversations = {};
let currentConvId = null;

function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function createConversation() {
    const id = genId();
    conversations[id] = { title: 'New chat', messages: [] };
    currentConvId = id;
    renderConvList();
    clearChatUI();
    showWelcome();
    syncCurrentConvToServer();
    saveState();
    switchNav('chat');
    return id;
}

function switchConversation(id) {
    if (!conversations[id]) return;
    currentConvId = id;
    renderConvList();
    clearChatUI();
    const conv = conversations[id];
    if (conv.messages.length === 0) {
        showWelcome();
    } else {
        removeWelcome();
        conv.messages.forEach(m => {
            const div = document.createElement('div');
            div.className = 'msg ' + m.role;
            div.textContent = m.text;
            messagesEl.appendChild(div);
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    syncCurrentConvToServer();
    switchNav('chat');
}

function deleteConversation(id) {
    delete conversations[id];
    if (currentConvId === id) {
        const ids = Object.keys(conversations);
        if (ids.length > 0) {
            switchConversation(ids[0]);
        } else {
            createConversation();
        }
    }
    renderConvList();
    saveState();
}

function clearChatUI() {
    messagesEl.innerHTML = '';
    $('#trace-content').innerHTML = '<div class="trace-empty">Agent communication will appear here when you send a message.</div>';
}

function showWelcome() {
    if ($('#chat-welcome')) return;
    const w = document.createElement('div');
    w.className = 'chat-welcome';
    w.id = 'chat-welcome';
    w.innerHTML = '<h2>AskBase</h2><p>Ask anything about your data in natural language. I remember our conversation.</p><div class="chips" id="chips"></div>';
    messagesEl.appendChild(w);
    const examples = ["Total commission by partner this month","Top 10 articles by page views","Revenue trend by week","Which partner has the highest CPC?","List all tables in my dataset"];
    $('#chips').innerHTML = examples.map(q => '<span class="chip">'+q+'</span>').join('');
    $$('.chip').forEach(c => c.addEventListener('click', () => {
        $('#q-input').value = c.textContent;
        sendMessage();
    }));
}

function removeWelcome() {
    const w = $('#chat-welcome');
    if (w) w.remove();
}

function renderConvList() {
    const list = $('#conv-list');
    const ids = Object.keys(conversations).reverse(); // newest first
    list.innerHTML = ids.map(id => {
        const c = conversations[id];
        const active = id === currentConvId ? ' active' : '';
        const title = escapeHtml(c.title || 'New chat');
        return '<div class="conv-item'+active+'" data-id="'+id+'">' +
            '<span class="conv-title">'+title+'</span>' +
            '<button class="conv-delete" data-id="'+id+'" title="Delete">&times;</button>' +
            '</div>';
    }).join('');

    list.querySelectorAll('.conv-item').forEach(el => {
        el.addEventListener('click', e => {
            if (e.target.classList.contains('conv-delete')) return;
            switchConversation(el.dataset.id);
        });
    });
    list.querySelectorAll('.conv-delete').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            deleteConversation(btn.dataset.id);
        });
    });
}

function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getCurrentMessages() {
    if (!currentConvId || !conversations[currentConvId]) return [];
    return conversations[currentConvId].messages;
}

function syncCurrentConvToServer() {
    if (!currentConvId || !conversations[currentConvId]) return;
    const msgs = conversations[currentConvId].messages;
    fetch('/api/restore-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs, conversation_id: currentConvId }),
    }).catch(() => {});
}

// =====================================================

function getConfig() {
    return {
        dbType,
        llmProvider,
        apiKey: $('#api-key').value,
        bqProject: $('#bq-project').value,
        bqDataset: $('#bq-dataset').value,
        host: $('#sql-host')?.value || '',
        port: $('#sql-port')?.value || '',
        database: $('#sql-database')?.value || '',
        user: $('#sql-user')?.value || '',
        password: $('#sql-password')?.value || '',
        sqlitePath: $('#sqlite-path')?.value || '',
        conversations,
        currentConvId,
    };
}

function saveState() { encryptAndStore(getConfig()); }

function applyConfig(cfg) {
    dbType = cfg.dbType || 'bigquery';
    const radio = document.querySelector('#db-radios input[value="'+dbType+'"]');
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
    llmProvider = cfg.llmProvider || 'openai';
    const llmRadio = document.querySelector('#llm-radios input[value="'+llmProvider+'"]');
    if (llmRadio) { llmRadio.checked = true; }
    $('#api-key').value = cfg.apiKey || '';
    $('#bq-project').value = cfg.bqProject || '';
    if (cfg.bqDataset) {
        const sel = $('#bq-dataset');
        sel.innerHTML = '<option value="'+cfg.bqDataset+'">'+cfg.bqDataset+'</option>';
        sel.value = cfg.bqDataset;
    }
    if (cfg.host) $('#sql-host').value = cfg.host;
    if (cfg.port) $('#sql-port').value = cfg.port;
    if (cfg.database) $('#sql-database').value = cfg.database;
    if (cfg.user) $('#sql-user').value = cfg.user;
    if (cfg.password) $('#sql-password').value = cfg.password;
    if (cfg.sqlitePath) $('#sqlite-path').value = cfg.sqlitePath;

    // Restore conversations (handle migration from old single chatHistory format)
    if (cfg.conversations && Object.keys(cfg.conversations).length > 0) {
        conversations = cfg.conversations;
        currentConvId = cfg.currentConvId || Object.keys(conversations)[0];
    } else if (cfg.chatHistory && cfg.chatHistory.length > 0) {
        // Migrate old single-chat format
        const id = genId();
        const firstMsg = cfg.chatHistory.find(m => m.role === 'user');
        conversations[id] = {
            title: firstMsg ? firstMsg.text.slice(0, 40) : 'Imported chat',
            messages: cfg.chatHistory,
        };
        currentConvId = id;
    }

    if (currentConvId && conversations[currentConvId]) {
        renderConvList();
        clearChatUI();
        const conv = conversations[currentConvId];
        if (conv.messages.length > 0) {
            removeWelcome();
            conv.messages.forEach(m => {
                const div = document.createElement('div');
                div.className = 'msg ' + m.role;
                div.textContent = m.text;
                messagesEl.appendChild(div);
            });
            messagesEl.scrollTop = messagesEl.scrollHeight;
        } else {
            showWelcome();
        }
    }
}

// -- Save --
let isReady = false;
$('#save-btn').addEventListener('click', async () => {
    const key = $('#api-key').value;
    if (!key) { setStatus2('err','API key is required'); return; }
    if (dbType === 'bigquery' && !$('#bq-project').value) { setStatus2('err','Project ID required'); return; }
    if ((dbType === 'mysql' || dbType === 'postgresql') && (!$('#sql-host').value || !$('#sql-database').value)) { setStatus2('err','Host and database required'); return; }
    if (dbType === 'sqlite' && !$('#sqlite-path').value) { setStatus2('err','File path required'); return; }
    isReady = true;
    // Create first conversation if none
    if (Object.keys(conversations).length === 0) {
        createConversation();
    }
    await encryptAndStore(getConfig());
    setStatus2('ok', 'Saved (encrypted). Switching to chat...');
    loadSchema();
    setTimeout(() => switchNav('chat'), 400);
});

function setStatus2(kind, text) {
    const el = $('#save-status');
    el.className = 'status ' + kind;
    el.innerHTML = '<span class="dot"></span>' + text;
}

// -- Restore on load --
let _pendingRestore = null;
(async () => {
    const cfg = await decryptFromStore();
    if (cfg && cfg.apiKey) {
        _pendingRestore = cfg;
    }
})();

// -- Chat --
const messagesEl = $('#chat-messages');
const inputEl = $('#q-input');
const sendBtn = $('#send-btn');
let isSending = false;

// Apply deferred restore now that messagesEl exists
(async () => {
    await new Promise(r => setTimeout(r, 50));
    if (_pendingRestore) {
        applyConfig(_pendingRestore);
        isReady = true;
        syncCurrentConvToServer();
        _pendingRestore = null;
    } else {
        // No saved state -- show welcome with chips
        showWelcome();
    }
    renderConvList();
})();

// New chat button
$('#new-chat-btn').addEventListener('click', () => {
    if (!isReady) { switchNav('setup'); return; }
    createConversation();
});

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

function addMessage(text, role) {
    removeWelcome();
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
}

async function sendMessage() {
    const q = inputEl.value.trim();
    if (!q || isSending) return;
    if (!isReady) {
        addMessage(q, 'user');
        addMessage('Please complete the Setup first (sidebar > Setup).', 'bot');
        inputEl.value = '';
        return;
    }

    // Ensure we have a conversation
    if (!currentConvId || !conversations[currentConvId]) {
        createConversation();
    }

    isSending = true;
    sendBtn.disabled = true;
    addMessage(q, 'user');
    conversations[currentConvId].messages.push({ role: 'user', text: q });

    // Auto-title from first user message
    if (conversations[currentConvId].messages.filter(m => m.role === 'user').length === 1) {
        conversations[currentConvId].title = q.slice(0, 50);
        renderConvList();
    }

    inputEl.value = '';
    inputEl.style.height = 'auto';

    const thinkMsg = addMessage('Thinking...', 'bot thinking');

    $('#trace-content').innerHTML = '<div class="trace-step"><span class="trace-msg" style="color:#bbb"><span class="spinner"></span>&nbsp; Running agent pipeline...</span></div>';

    const fd = new FormData();
    fd.append('question', q);
    fd.append('db_type', dbType);
    fd.append('api_key', $('#api-key').value);
    fd.append('llm_provider', llmProvider);
    fd.append('bq_project', $('#bq-project').value);
    fd.append('bq_dataset', $('#bq-dataset').value);
    fd.append('host', $('#sql-host')?.value || '');
    fd.append('port', $('#sql-port')?.value || '');
    fd.append('database', $('#sql-database')?.value || '');
    fd.append('user', $('#sql-user')?.value || '');
    fd.append('password', $('#sql-password')?.value || '');
    fd.append('sqlite_path', $('#sqlite-path')?.value || '');
    fd.append('conversation_id', currentConvId);

    try {
        const r = await fetch('/api/ask', { method: 'POST', body: fd });
        const d = await r.json();
        thinkMsg.remove();
        if (d.ok) {
            addMessage(d.answer, 'bot');
            conversations[currentConvId].messages.push({ role: 'bot', text: d.answer });
            if (d.trace) renderTrace(d.trace);
        } else {
            addMessage('Error: ' + d.error, 'bot');
            conversations[currentConvId].messages.push({ role: 'bot', text: 'Error: ' + d.error });
        }
    } catch(e) {
        thinkMsg.remove();
        addMessage('Error: ' + e.message, 'bot');
        conversations[currentConvId].messages.push({ role: 'bot', text: 'Error: ' + e.message });
    }

    // Trim messages per conversation
    if (conversations[currentConvId].messages.length > 100) {
        conversations[currentConvId].messages = conversations[currentConvId].messages.slice(-100);
    }
    saveState();

    isSending = false;
    sendBtn.disabled = false;
    inputEl.focus();
}

// -- Agent Trace --
function renderTrace(trace) {
    const box = $('#trace-content');
    if (!trace || !trace.length) { box.innerHTML = '<div class="trace-empty">No agent data for this query.</div>'; return; }
    const agentClass = name => {
        const n = name.toLowerCase();
        if (n.includes('orchestrat')) return 'orchestrator';
        if (n.includes('analyz')) return 'analyzer';
        if (n.includes('planner')) return 'planner';
        if (n.includes('sql')) return 'sql-writer';
        if (n.includes('valid')) return 'validator';
        if (n.includes('exec')) return 'executor';
        if (n.includes('format')) return 'formatter';
        return 'system';
    };
    box.innerHTML = trace.map(s =>
        '<div class="trace-step">' +
        '<span class="trace-agent ' + agentClass(s.agent) + '">' + s.agent + '</span>' +
        '<span class="trace-msg">' + s.message.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>' +
        '</div>'
    ).join('');
    box.scrollTop = box.scrollHeight;
}

// -- Schema --
function getConnFormData() {
    const fd = new FormData();
    fd.append('db_type', dbType);
    fd.append('bq_project', $('#bq-project').value);
    fd.append('bq_dataset', $('#bq-dataset').value);
    fd.append('host', $('#sql-host')?.value || '');
    fd.append('port', $('#sql-port')?.value || '');
    fd.append('database', $('#sql-database')?.value || '');
    fd.append('user', $('#sql-user')?.value || '');
    fd.append('password', $('#sql-password')?.value || '');
    fd.append('sqlite_path', $('#sqlite-path')?.value || '');
    return fd;
}

async function loadSchema() {
    const el = $('#schema-list');
    el.innerHTML = '<span style="color:#aaa">Loading schema...</span>';
    try {
        const r = await fetch('/api/schema', { method: 'POST', body: getConnFormData() });
        const data = await r.json();
        const entries = Object.entries(data).filter(([k]) => !k.startsWith('_'));
        if (!entries.length) { el.innerHTML = '<span style="color:#aaa">No tables found.</span>'; return; }
        el.innerHTML = entries.sort((a,b)=>a[0].localeCompare(b[0]))
            .map(([t,cols]) => '<div class="tn">'+t+'</div><p class="tc">'+cols.join(', ')+'</p>').join('');
    } catch(e) { el.innerHTML = '<span style="color:#aaa">Could not load schema.</span>'; }
}

$$('.nav-item').forEach(n => n.addEventListener('click', () => {
    if (n.dataset.tab === 'schema' && isReady) loadSchema();
}));

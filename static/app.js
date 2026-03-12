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

// -- Home logo -> back to chat --
$('#home-btn').addEventListener('click', () => {
    $$('.nav-item').forEach(x => x.classList.remove('active'));
    $$('.panel').forEach(x => x.classList.remove('active'));
    $$('.chat-panel').forEach(x => x.classList.remove('active'));
    $('#p-chat').classList.add('active');
});

function switchNav(name) {
    $$('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    $$('.panel').forEach(x => x.classList.remove('active'));
    $$('.chat-panel').forEach(x => x.classList.remove('active'));
    const target = $('#p-' + name);
    if (target) target.classList.add('active');
    // If switching to chat, no nav item is highlighted (logo is the "home")
}

// -- Trace sidebar toggle --
$('#trace-close').addEventListener('click', () => {
    $('#trace-sidebar').classList.add('hidden');
    $('#trace-toggle').classList.add('visible');
});
$('#trace-toggle').addEventListener('click', () => {
    $('#trace-sidebar').classList.remove('hidden');
    $('#trace-toggle').classList.remove('visible');
});

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
// Global audit state (shared across all conversations)
// =====================================================
let globalAudit = null; // { text, usage, timestamp }

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
    restoreAllTraces();
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
    } else if (conv.messages.length > 0) {
        removeWelcome();
        let lastUserQ = '';
        conv.messages.forEach(m => {
            if (m.role === 'user') lastUserQ = m.text;
            const div = document.createElement('div');
            div.className = 'msg ' + m.role;
            if (m.role === 'bot') {
                div.innerHTML = formatBotMessage(m.text);
            } else {
                div.textContent = m.text;
            }
            messagesEl.appendChild(div);
            if (m.sql) renderSqlPreview(m.sql);
            if (m.columns && m.rows && m.rows.length > 0) {
                renderDataTable(m.columns, m.rows);
                renderChart(m.columns, m.rows);
                renderExportButtons(m.columns, m.rows, lastUserQ, m.text);
            }
            if (m.usage && m.usage.total_tokens) renderTokenBadge(m.usage);
        });
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    restoreAllTraces();
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
}

function showWelcome() {
    if ($('#chat-welcome')) return;
    const w = document.createElement('div');
    w.className = 'chat-welcome';
    w.id = 'chat-welcome';
    w.innerHTML = '<h2>AskBase</h2><p>Ask anything about your data in natural language. I remember our conversation.</p><div class="chips" id="chips"></div>';
    messagesEl.appendChild(w);
    const examples = ["Top 5 customers by total spending","Revenue trend by month","Which product has the best average rating?","How many orders per customer?","Show me the most reviewed products"];
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
        // Remove old per-conversation audit messages (migrating to global)
        for (const id of Object.keys(cfg.conversations)) {
            cfg.conversations[id].messages = (cfg.conversations[id].messages || []).filter(m => !m.isAudit);
        }
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
            let lastQ = '';
            conv.messages.forEach(m => {
                if (m.role === 'user') lastQ = m.text;
                const div = document.createElement('div');
                div.className = 'msg ' + m.role;
                if (m.role === 'bot') {
                    div.innerHTML = formatBotMessage(m.text);
                } else {
                    div.textContent = m.text;
                }
                messagesEl.appendChild(div);
                if (m.sql) renderSqlPreview(m.sql);
                if (m.columns && m.rows && m.rows.length > 0) {
                    renderDataTable(m.columns, m.rows);
                    renderChart(m.columns, m.rows);
                    renderExportButtons(m.columns, m.rows, lastQ, m.text);
                }
                if (m.usage && m.usage.total_tokens) renderTokenBadge(m.usage);
            });
            messagesEl.scrollTop = messagesEl.scrollHeight;
        } else {
            showWelcome();
        }
        restoreAllTraces();
    }
}

// -- Demo mode --
$('#demo-btn').addEventListener('click', async () => {
    const btn = $('#demo-btn');
    btn.textContent = 'Setting up...';
    btn.disabled = true;
    try {
        const r = await fetch('/api/demo', { method: 'POST' });
        const d = await r.json();
        if (d.ok) {
            // Switch to SQLite + fill path
            dbType = 'sqlite';
            const radio = document.querySelector('#db-radios input[value="sqlite"]');
            if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
            $('#sqlite-path').value = d.path;
            $('#demo-banner').innerHTML = '<span style="color:#16a34a;font-size:.8125rem;font-weight:600">Demo database active. Just add your API key below and click Save.</span>';
        } else {
            btn.textContent = 'Error: ' + d.error;
        }
    } catch(e) {
        btn.textContent = 'Error';
    }
});

// -- Save --
let isReady = false;
$('#save-btn').addEventListener('click', async () => {
    const key = $('#api-key').value;
    if (!key) { setStatus2('err','API key is required'); return; }
    if (dbType === 'bigquery' && !$('#bq-project').value) { setStatus2('err','Project ID required'); return; }
    if ((dbType === 'mysql' || dbType === 'postgresql') && (!$('#sql-host').value || !$('#sql-database').value)) { setStatus2('err','Host and database required'); return; }
    if (dbType === 'sqlite' && !$('#sqlite-path').value) { setStatus2('err','File path required'); return; }
    const isFirstSetup = !isReady;
    isReady = true;
    // Create first conversation if none
    if (Object.keys(conversations).length === 0) {
        createConversation();
    }
    await encryptAndStore(getConfig());
    setStatus2('ok', 'Saved (encrypted). Switching to chat...');
    loadSchema();
    setTimeout(() => {
        switchNav('chat');
        // Auto-audit on first connection
        if (isFirstSetup) {
            setTimeout(() => runAudit(), 300);
        }
    }, 400);
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
        // Load audit from server DB
        await loadSavedAudit();
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

function formatBotMessage(text) {
    // Escape HTML first
    let html = escapeHtml(text);
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Inline code: `text`
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
}

function addMessage(text, role) {
    removeWelcome();
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    if (role === 'bot' || role === 'bot thinking') {
        div.innerHTML = formatBotMessage(text);
    } else {
        div.textContent = text;
    }
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
    addToHistory(q);
    conversations[currentConvId].messages.push({ role: 'user', text: q });

    // Auto-title from first user message
    if (conversations[currentConvId].messages.filter(m => m.role === 'user').length === 1) {
        conversations[currentConvId].title = q.slice(0, 50);
        renderConvList();
    }

    inputEl.value = '';
    inputEl.style.height = 'auto';

    const thinkMsg = addMessage('Thinking...', 'bot thinking');

    // Setup trace sidebar for live streaming
    const traceBox = $('#trace-content');
    const emptyEl = traceBox.querySelector('.trace-empty');
    if (emptyEl) emptyEl.remove();

    // Add separator for this question
    const sep = document.createElement('div');
    sep.className = 'trace-separator';
    sep.innerHTML = '<span>' + escapeHtml(q) + '</span>';
    traceBox.appendChild(sep);

    const liveTraceSteps = []; // collect for saving

    const fd = buildFormData({ question: q, conversation_id: currentConvId });

    try {
        const r = await fetch('/api/ask-stream', { method: 'POST', body: fd });
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Parse SSE lines
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6);
                let event;
                try { event = JSON.parse(jsonStr); } catch { continue; }

                if (event.type === 'trace') {
                    // Live trace step -- add to sidebar immediately
                    liveTraceSteps.push({ agent: event.agent, message: event.message });
                    const step = document.createElement('div');
                    step.className = 'trace-step';
                    step.innerHTML = '<span class="trace-agent ' + agentClass(event.agent) + '">' + event.agent + '</span>' +
                        '<span class="trace-msg">' + event.message.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>';
                    traceBox.appendChild(step);
                    traceBox.scrollTop = traceBox.scrollHeight;

                    // Show live reasoning in the thinking bubble
                    const shortMsg = event.message.length > 150 ? event.message.slice(0, 150) + '...' : event.message;
                    thinkMsg.innerHTML = '<span class="think-agent">' + event.agent + '</span> ' + escapeHtml(shortMsg);
                }

                if (event.type === 'result') {
                    finalResult = event.data;
                }

                if (event.type === 'error') {
                    finalResult = { ok: false, error: event.error };
                }
            }
        }

        thinkMsg.remove();

        if (finalResult && finalResult.answer) {
            addMessage(finalResult.answer, 'bot');
            const msg = { role: 'bot', text: finalResult.answer };
            if (finalResult.sql) {
                msg.sql = finalResult.sql;
                renderSqlPreview(finalResult.sql);
            }
            if (finalResult.columns && finalResult.rows && finalResult.rows.length > 0) {
                msg.columns = finalResult.columns;
                msg.rows = finalResult.rows;
                renderDataTable(finalResult.columns, finalResult.rows);
                renderChart(finalResult.columns, finalResult.rows);
                renderExportButtons(finalResult.columns, finalResult.rows, q, finalResult.answer);
            }
            if (liveTraceSteps.length) msg.trace = liveTraceSteps;
            if (finalResult.usage) msg.usage = finalResult.usage;
            conversations[currentConvId].messages.push(msg);
            // Show token usage badge
            if (finalResult.usage && finalResult.usage.total_tokens) {
                renderTokenBadge(finalResult.usage);
            }
        } else if (finalResult && finalResult.error) {
            addMessage('Error: ' + finalResult.error, 'bot');
            conversations[currentConvId].messages.push({ role: 'bot', text: 'Error: ' + finalResult.error });
        } else {
            addMessage('No response received.', 'bot');
            conversations[currentConvId].messages.push({ role: 'bot', text: 'No response received.' });
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

// =====================================================
// Database Audit (dedicated panel)
// =====================================================

let isAuditing = false;
const auditContentEl = $('#audit-content');
const auditEditorEl = $('#audit-editor');
const auditRunBtn = $('#audit-run-btn');
const auditEditBtn = $('#audit-edit-btn');
const auditSaveBtn = $('#audit-save-btn');
const auditCancelBtn = $('#audit-cancel-btn');

auditRunBtn.addEventListener('click', () => runAudit());

auditEditBtn.addEventListener('click', () => {
    // Switch to edit mode
    auditEditorEl.value = globalAudit?.text || '';
    auditContentEl.style.display = 'none';
    auditEditorEl.style.display = '';
    auditEditBtn.style.display = 'none';
    auditRunBtn.style.display = 'none';
    auditSaveBtn.style.display = '';
    auditCancelBtn.style.display = '';
});

auditCancelBtn.addEventListener('click', () => {
    // Back to read mode
    auditEditorEl.style.display = 'none';
    auditContentEl.style.display = '';
    auditSaveBtn.style.display = 'none';
    auditCancelBtn.style.display = 'none';
    auditEditBtn.style.display = '';
    auditRunBtn.style.display = '';
});

auditSaveBtn.addEventListener('click', async () => {
    const newText = auditEditorEl.value.trim();
    if (!newText) return;
    auditSaveBtn.disabled = true;
    auditSaveBtn.textContent = 'Saving...';
    try {
        const r = await fetch('/api/audit', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText }),
        });
        const data = await r.json();
        if (data.ok) {
            globalAudit.text = newText;
            renderAuditPanel();
        }
    } catch (e) {
        console.error('Failed to save audit:', e);
    }
    auditSaveBtn.disabled = false;
    auditSaveBtn.textContent = 'Save';
});

function renderAuditPanel() {
    // Show read mode with formatted content
    auditEditorEl.style.display = 'none';
    auditContentEl.style.display = '';
    auditSaveBtn.style.display = 'none';
    auditCancelBtn.style.display = 'none';

    if (globalAudit && globalAudit.text) {
        auditContentEl.innerHTML = formatAuditMarkdown(globalAudit.text);
        if (globalAudit.usage && globalAudit.usage.total_tokens) {
            auditContentEl.innerHTML += '<div class="audit-token-info">' +
                (globalAudit.usage.total_tokens || 0).toLocaleString() + ' tokens' +
                (globalAudit.updated_at ? ' — ' + new Date(globalAudit.updated_at).toLocaleString() : '') +
                '</div>';
        }
        auditEditBtn.style.display = '';
        auditRunBtn.textContent = 'Re-audit';
    } else {
        auditContentEl.innerHTML = '<p style="color:#aaa;font-size:.8125rem">No audit yet. Click "Run Audit" to analyze your database.</p>';
        auditEditBtn.style.display = 'none';
        auditRunBtn.textContent = 'Run Audit';
    }
    auditRunBtn.style.display = '';
}

async function loadSavedAudit() {
    try {
        const r = await fetch('/api/audit');
        const data = await r.json();
        if (data.ok && data.text) {
            globalAudit = { text: data.text, usage: data.usage || {}, updated_at: data.updated_at };
            renderAuditPanel();
            return true;
        }
    } catch {}
    return false;
}

async function runAudit() {
    if (isAuditing || !isReady) return;
    isAuditing = true;
    auditRunBtn.disabled = true;
    auditRunBtn.textContent = 'Auditing...';
    auditEditBtn.style.display = 'none';

    // Show progress in the audit panel content
    auditContentEl.style.display = '';
    auditEditorEl.style.display = 'none';
    auditSaveBtn.style.display = 'none';
    auditCancelBtn.style.display = 'none';
    auditContentEl.innerHTML = '<p style="color:#888;font-size:.8125rem">Analyzing your database...</p>';

    // Navigate to audit panel
    switchNav('audit');

    const fd = buildFormData({ language: (navigator.language || 'en').slice(0, 2) });

    try {
        const r = await fetch('/api/audit-stream', { method: 'POST', body: fd });
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult = null;
        let traceLines = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                let event;
                try { event = JSON.parse(line.slice(6)); } catch { continue; }

                if (event.type === 'trace') {
                    traceLines.push(event.message);
                    const shortMsg = event.message.length > 120 ? event.message.slice(0, 120) + '...' : event.message;
                    auditContentEl.innerHTML = '<p style="color:#888;font-size:.8125rem">' +
                        escapeHtml(event.agent) + ': ' + escapeHtml(shortMsg) + '</p>';
                }

                if (event.type === 'result') finalResult = event.data;
                if (event.type === 'error') finalResult = { error: event.error };
            }
        }

        if (finalResult && finalResult.audit) {
            globalAudit = { text: finalResult.audit, usage: finalResult.usage || {} };
            renderAuditPanel();
        } else if (finalResult && finalResult.error) {
            auditContentEl.innerHTML = '<p style="color:#e53e3e;font-size:.8125rem">Error: ' + escapeHtml(finalResult.error) + '</p>';
        } else {
            auditContentEl.innerHTML = '<p style="color:#e53e3e;font-size:.8125rem">Could not complete the audit.</p>';
        }
    } catch(e) {
        auditContentEl.innerHTML = '<p style="color:#e53e3e;font-size:.8125rem">Error: ' + escapeHtml(e.message) + '</p>';
    }

    isAuditing = false;
    auditRunBtn.disabled = false;
    renderAuditPanel();
}

function formatAuditMarkdown(text) {
    let html = escapeHtml(text);
    // Headers: ### > h3, ## > h2, # > h1
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    // Bullet lists (- item)
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    // Wrap consecutive <li> in <ul>
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    // Numbered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // Line breaks (but not inside tags)
    html = html.replace(/\n/g, '<br>');
    // Clean up <br> after block elements
    html = html.replace(/(<\/h[123]>)<br>/g, '$1');
    html = html.replace(/(<\/ul>)<br>/g, '$1');
    html = html.replace(/(<\/li>)<br>/g, '$1');
    return html;
}

// -- Agent Trace --
const agentClass = name => {
    const n = name.toLowerCase();
    if (n.includes('audit')) return 'auditor';
    if (n.includes('orchestrat')) return 'orchestrator';
    if (n.includes('reason')) return 'reasoner';
    if (n.includes('analyz')) return 'analyzer';
    if (n.includes('planner')) return 'planner';
    if (n.includes('sql')) return 'sql-writer';
    if (n.includes('valid')) return 'validator';
    if (n.includes('exec')) return 'executor';
    if (n.includes('format')) return 'formatter';
    return 'system';
};

function renderTrace(trace, question) {
    const box = $('#trace-content');
    if (!trace || !trace.length) return;

    // Remove empty placeholder if present
    const empty = box.querySelector('.trace-empty');
    if (empty) empty.remove();

    // Add a separator with the question
    const sep = document.createElement('div');
    sep.className = 'trace-separator';
    sep.innerHTML = '<span>' + escapeHtml(question || 'Query') + '</span>';
    box.appendChild(sep);

    trace.forEach(s => {
        const step = document.createElement('div');
        step.className = 'trace-step';
        step.innerHTML = '<span class="trace-agent ' + agentClass(s.agent) + '">' + s.agent + '</span>' +
            '<span class="trace-msg">' + s.message.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>';
        box.appendChild(step);
    });
    box.scrollTop = box.scrollHeight;
}

function restoreAllTraces() {
    const box = $('#trace-content');
    box.innerHTML = '';
    if (!currentConvId || !conversations[currentConvId]) {
        box.innerHTML = '<div class="trace-empty">Agent communication will appear here when you send a message.</div>';
        return;
    }
    const msgs = conversations[currentConvId].messages;
    let hasTrace = false;
    for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].trace && msgs[i].trace.length) {
            hasTrace = true;
            // Find the preceding user question
            let q = 'Query';
            for (let j = i - 1; j >= 0; j--) {
                if (msgs[j].role === 'user') { q = msgs[j].text; break; }
            }
            renderTrace(msgs[i].trace, q);
        }
    }
    if (!hasTrace) {
        box.innerHTML = '<div class="trace-empty">Agent communication will appear here when you send a message.</div>';
    }
}

// -- Connection helpers --
function getConnFields() {
    return {
        db_type: dbType,
        api_key: $('#api-key').value,
        llm_provider: llmProvider,
        bq_project: $('#bq-project').value,
        bq_dataset: $('#bq-dataset').value,
        host: $('#sql-host')?.value || '',
        port: $('#sql-port')?.value || '',
        database: $('#sql-database')?.value || '',
        user: $('#sql-user')?.value || '',
        password: $('#sql-password')?.value || '',
        sqlite_path: $('#sqlite-path')?.value || '',
    };
}

function buildFormData(extra = {}) {
    const fd = new FormData();
    const fields = { ...getConnFields(), ...extra };
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
}

function getConnFormData() { return buildFormData(); }

async function loadSchema() {
    const el = $('#schema-list');
    el.innerHTML = '<span style="color:#aaa">Loading schema...</span>';
    try {
        const r = await fetch('/api/schema', { method: 'POST', body: getConnFormData() });
        const data = await r.json();
        const entries = Object.entries(data).filter(([k]) => !k.startsWith('_'));
        if (!entries.length) { el.innerHTML = '<span style="color:#aaa">No tables found.</span>'; return; }

        // Detect FK relationships by convention: column ending in _id matching a table name
        const tableNames = new Set(entries.map(([t]) => t));
        const relationships = [];
        entries.forEach(([table, info]) => {
            if (Array.isArray(info)) return;
            (info.columns || []).forEach(col => {
                if (col.name.endsWith('_id')) {
                    const ref = col.name.replace(/_id$/, '');
                    // Try singular and plural matches
                    const candidates = [ref, ref + 's', ref + 'es'];
                    for (const c of candidates) {
                        if (tableNames.has(c) && c !== table) {
                            relationships.push({ from: table, col: col.name, to: c });
                            break;
                        }
                    }
                }
            });
        });

        // Render relationships section if found
        let relHtml = '';
        if (relationships.length) {
            relHtml = '<div class="schema-relationships">' +
                '<div class="sl">Relationships</div>' +
                '<div class="rel-list">' +
                relationships.map(r =>
                    '<div class="rel-item">' +
                        '<span class="rel-table">' + escapeHtml(r.from) + '</span>' +
                        '<span class="rel-col">.' + escapeHtml(r.col) + '</span>' +
                        '<span class="rel-arrow">&rarr;</span>' +
                        '<span class="rel-table">' + escapeHtml(r.to) + '</span>' +
                        '<span class="rel-col">.id</span>' +
                    '</div>'
                ).join('') +
                '</div></div>';
        }

        const tablesHtml = entries.sort((a,b)=>a[0].localeCompare(b[0])).map(([t, info]) => {
            if (Array.isArray(info)) {
                return '<div class="catalog-table"><div class="tn">'+t+'</div><p class="tc">'+info.join(', ')+'</p></div>';
            }
            const rowCount = info.row_count != null ? '<span class="catalog-rows">'+Number(info.row_count).toLocaleString()+' rows</span>' : '';
            const cols = (info.columns || []).map(c => {
                const isFK = relationships.some(r => r.from === t && r.col === c.name);
                return '<div class="catalog-col' + (isFK ? ' fk' : '') + '">' +
                    '<span class="catalog-col-name">' + escapeHtml(c.name) + (isFK ? ' <span class="fk-badge">FK</span>' : '') + '</span>' +
                    '<span class="catalog-col-type">' + escapeHtml(c.type) + '</span>' +
                '</div>';
            }).join('');
            return '<div class="catalog-table">' +
                '<div class="catalog-header"><span class="tn">'+escapeHtml(t)+'</span>'+rowCount+'</div>' +
                '<div class="catalog-cols">'+cols+'</div>' +
                '</div>';
        }).join('');

        el.innerHTML = relHtml + tablesHtml;
    } catch(e) { el.innerHTML = '<span style="color:#aaa">Could not load schema.</span>'; }
}

$$('.nav-item').forEach(n => n.addEventListener('click', () => {
    if (n.dataset.tab === 'schema' && isReady) loadSchema();
    if (n.dataset.tab === 'history') renderHistory();
    if (n.dataset.tab === 'dashboard') renderDashboard();
    if (n.dataset.tab === 'alerts') loadSchedules();
}));

// =====================================================
// Scheduled Reports
// =====================================================

$('#alert-save-btn')?.addEventListener('click', async () => {
    const question = $('#alert-question').value.trim();
    const cron = $('#alert-cron').value.trim();
    const botToken = $('#alert-bot-token').value.trim();
    const chatId = $('#alert-chat-id').value.trim();

    if (!question) { setAlertStatus('err', 'Question required'); return; }
    if (!botToken || !chatId) { setAlertStatus('err', 'Bot token and chat ID required'); return; }

    try {
        const r = await fetch('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question, cron, channel: 'telegram',
                bot_token: botToken, chat_id: chatId,
                ...getConnFields(),
            }),
        });
        const d = await r.json();
        if (d.ok) {
            setAlertStatus('ok', 'Schedule created!');
            $('#alert-question').value = '';
            loadSchedules();
        } else {
            setAlertStatus('err', d.error || 'Failed');
        }
    } catch(e) { setAlertStatus('err', e.message); }
});

function setAlertStatus(kind, text) {
    const el = $('#alert-status');
    if (!el) return;
    el.className = 'status ' + kind;
    el.innerHTML = '<span class="dot"></span>' + text;
}

async function loadSchedules() {
    const el = $('#alert-list');
    if (!el) return;
    try {
        const r = await fetch('/api/schedules');
        const d = await r.json();
        if (!d.jobs || !d.jobs.length) {
            el.innerHTML = '<span style="color:#aaa;font-size:.8125rem">No schedules yet.</span>';
            return;
        }
        el.innerHTML = d.jobs.map(j =>
            '<div class="schedule-item">' +
            '<div class="schedule-info">' +
            '<span class="schedule-q">' + escapeHtml(j.question) + '</span>' +
            '<span class="schedule-meta">Every day at ' + escapeHtml(j.cron) + ' via ' + escapeHtml(j.channel) +
            (j.last_status ? ' &bull; Last: ' + escapeHtml(j.last_status) : '') + '</span>' +
            '</div>' +
            '<button class="btn-export schedule-delete" data-id="' + j.id + '">Delete</button>' +
            '</div>'
        ).join('');
        el.querySelectorAll('.schedule-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                await fetch('/api/schedules/' + btn.dataset.id, { method: 'DELETE' });
                loadSchedules();
            });
        });
    } catch(e) { el.innerHTML = '<span style="color:#aaa;font-size:.8125rem">Could not load schedules.</span>'; }
}

// =====================================================
// Query History + Favorites
// =====================================================

let queryHistory = JSON.parse(localStorage.getItem('askbase_history') || '[]');
let favorites = JSON.parse(localStorage.getItem('askbase_favorites') || '[]');

function addToHistory(question) {
    const entry = { q: question, time: Date.now() };
    queryHistory.unshift(entry);
    if (queryHistory.length > 200) queryHistory = queryHistory.slice(0, 200);
    localStorage.setItem('askbase_history', JSON.stringify(queryHistory));
}

function toggleFavorite(question) {
    const idx = favorites.indexOf(question);
    if (idx >= 0) favorites.splice(idx, 1);
    else favorites.push(question);
    localStorage.setItem('askbase_favorites', JSON.stringify(favorites));
    renderHistory();
}

function renderHistory() {
    const el = $('#history-list');
    if (!queryHistory.length) {
        el.innerHTML = '<span style="color:#aaa">No queries yet. Start asking questions!</span>';
        return;
    }

    // Show favorites first, then recent
    const favSet = new Set(favorites);
    const sorted = [...queryHistory].sort((a, b) => {
        const aFav = favSet.has(a.q) ? 1 : 0;
        const bFav = favSet.has(b.q) ? 1 : 0;
        if (aFav !== bFav) return bFav - aFav;
        return b.time - a.time;
    });

    // Deduplicate
    const seen = new Set();
    const unique = sorted.filter(e => {
        if (seen.has(e.q)) return false;
        seen.add(e.q);
        return true;
    });

    el.innerHTML = unique.slice(0, 50).map(e => {
        const isFav = favSet.has(e.q);
        const time = new Date(e.time).toLocaleDateString();
        return '<div class="history-item" data-q="' + escapeHtml(e.q) + '">' +
            '<button class="history-fav' + (isFav ? ' active' : '') + '" title="Favorite">&#9733;</button>' +
            '<span class="history-q">' + escapeHtml(e.q) + '</span>' +
            '<span class="history-time">' + time + '</span>' +
            '</div>';
    }).join('');

    el.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', e => {
            if (e.target.classList.contains('history-fav')) {
                e.stopPropagation();
                toggleFavorite(item.dataset.q);
                return;
            }
            // Re-execute query
            switchNav('chat');
            $('#q-input').value = item.dataset.q;
            sendMessage();
        });
    });
}

// =====================================================
// SQL Preview
// =====================================================

function renderSqlPreview(sql) {
    if (!sql) return;
    const wrap = document.createElement('div');
    wrap.className = 'sql-preview';
    wrap.innerHTML =
        '<div class="sql-preview-header">' +
            '<span class="sql-preview-label">SQL</span>' +
            '<button class="sql-toggle-btn">Show</button>' +
        '</div>' +
        '<div class="sql-preview-body" style="display:none">' +
            '<textarea class="sql-editor" spellcheck="false">' + escapeHtml(sql) + '</textarea>' +
            '<div class="sql-preview-actions">' +
                '<button class="btn-export sql-copy-btn">Copy</button>' +
                '<button class="btn-export sql-run-btn">Edit & Re-run</button>' +
            '</div>' +
        '</div>';

    // Insert after last bot message
    const msgs = messagesEl.querySelectorAll('.msg.bot:not(.thinking)');
    const lastBot = msgs[msgs.length - 1];
    if (lastBot) lastBot.after(wrap);
    else messagesEl.appendChild(wrap);

    const toggleBtn = wrap.querySelector('.sql-toggle-btn');
    const body = wrap.querySelector('.sql-preview-body');
    toggleBtn.addEventListener('click', () => {
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        toggleBtn.textContent = hidden ? 'Hide' : 'Show';
    });

    wrap.querySelector('.sql-copy-btn').addEventListener('click', () => {
        const editor = wrap.querySelector('.sql-editor');
        navigator.clipboard.writeText(editor.value).then(() => {
            wrap.querySelector('.sql-copy-btn').textContent = 'Copied!';
            setTimeout(() => wrap.querySelector('.sql-copy-btn').textContent = 'Copy', 1500);
        });
    });

    wrap.querySelector('.sql-run-btn').addEventListener('click', async () => {
        const editor = wrap.querySelector('.sql-editor');
        const editedSql = editor.value.trim();
        if (!editedSql) return;
        await executeRawSql(editedSql);
    });
}

async function executeRawSql(sql) {
    if (isSending) return;
    isSending = true;
    sendBtn.disabled = true;

    addMessage('[Re-running edited SQL]', 'user');
    const thinkMsg = addMessage('Executing...', 'bot thinking');

    const fd = buildFormData({ sql, conversation_id: currentConvId });

    try {
        const r = await fetch('/api/execute-sql', { method: 'POST', body: fd });
        const data = await r.json();
        thinkMsg.remove();

        if (data.ok && data.columns) {
            addMessage('Query executed successfully (' + data.rows.length + ' rows)', 'bot');
            renderDataTable(data.columns, data.rows);
            renderChart(data.columns, data.rows);
            renderExportButtons(data.columns, data.rows);
            conversations[currentConvId].messages.push({
                role: 'bot', text: 'SQL result', columns: data.columns, rows: data.rows, sql: sql,
            });
        } else if (data.error) {
            addMessage('SQL Error: ' + data.error, 'bot');
            conversations[currentConvId].messages.push({ role: 'bot', text: 'SQL Error: ' + data.error });
        }
    } catch(e) {
        thinkMsg.remove();
        addMessage('Error: ' + e.message, 'bot');
    }

    saveState();
    isSending = false;
    sendBtn.disabled = false;
}

// =====================================================
// Auto-Dashboard (Chart.js)
// =====================================================

let currentChart = null;

const CHART_COLORS = [
    '#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6',
    '#ec4899','#06b6d4','#f97316','#14b8a6','#a855f7',
    '#3b82f6','#eab308','#22c55e','#e11d48','#7c3aed',
];

function isNumeric(val) {
    if (val === '' || val === null || val === undefined) return false;
    return !isNaN(Number(val));
}

function isDateLike(val) {
    if (!val || typeof val !== 'string') return false;
    return /^\d{4}[-/]\d{2}([-/]\d{2})?/.test(val) || /^\d{2}[-/]\d{2}[-/]\d{4}/.test(val);
}

function isIdColumn(name) {
    const n = name.toLowerCase().trim();
    return n === 'id' || n.endsWith('_id') || n.endsWith('id');
}

function detectChartType(columns, rows) {
    if (!rows.length || !columns.length || columns.length < 2) return null;

    // Analyze each column: is it numeric, date, or label?
    const colTypes = columns.map((col, i) => {
        const vals = rows.map(r => r[i]).filter(v => v !== '' && v != null);
        const numCount = vals.filter(isNumeric).length;
        const dateCount = vals.filter(isDateLike).length;
        if (numCount > vals.length * 0.8) return 'numeric';
        if (dateCount > vals.length * 0.8) return 'date';
        return 'label';
    });

    const labelIdx = colTypes.findIndex(t => t === 'label');
    const dateIdx = colTypes.findIndex(t => t === 'date');
    // Exclude id columns from numeric data
    const numericIndices = colTypes.map((t, i) => (t === 'numeric' && !isIdColumn(columns[i])) ? i : -1).filter(i => i >= 0);

    if (numericIndices.length === 0) return null;

    // Date + numeric -> line chart
    if (dateIdx >= 0 && numericIndices.length >= 1) {
        return { type: 'line', labelCol: dateIdx, dataCols: numericIndices };
    }

    // Label + 1 numeric, few rows -> pie
    if (labelIdx >= 0 && numericIndices.length === 1 && rows.length <= 8) {
        return { type: 'pie', labelCol: labelIdx, dataCols: numericIndices };
    }

    // Label + numeric(s) -> bar
    if (labelIdx >= 0 && numericIndices.length >= 1) {
        return { type: 'bar', labelCol: labelIdx, dataCols: numericIndices };
    }

    // Fallback: first col as label, rest numeric -> bar
    if (numericIndices.length >= 1) {
        return { type: 'bar', labelCol: 0, dataCols: numericIndices };
    }

    return null;
}

function renderDataTable(columns, rows) {
    if (!columns || !rows || !rows.length) return;
    const maxRows = Math.min(rows.length, 20);
    const container = document.createElement('div');
    container.className = 'data-table-wrap';
    let html = '<table class="data-table"><thead><tr>';
    columns.forEach(c => html += '<th>' + escapeHtml(c) + '</th>');
    html += '</tr></thead><tbody>';
    for (let i = 0; i < maxRows; i++) {
        html += '<tr>';
        rows[i].forEach(v => html += '<td>' + escapeHtml(String(v ?? '')) + '</td>');
        html += '</tr>';
    }
    html += '</tbody></table>';
    if (rows.length > maxRows) {
        html += '<div class="data-table-more">' + rows.length + ' rows total</div>';
    }
    container.innerHTML = html;

    const msgs = messagesEl.querySelectorAll('.msg.bot:not(.thinking)');
    const lastBot = msgs[msgs.length - 1];
    if (lastBot) lastBot.after(container);
    else messagesEl.appendChild(container);
}

function renderChart(columns, rows) {
    // Don't destroy old charts -- keep them in the chat
    if (currentChart) { currentChart = null; }

    if (!columns || !rows || !rows.length) return;

    const config = detectChartType(columns, rows);
    if (!config) return;

    // Create container with unique ID
    const container = document.createElement('div');
    container.className = 'chart-container';
    const canvas = document.createElement('canvas');
    canvas.id = 'auto-chart-' + Date.now();
    container.appendChild(canvas);

    // Insert after the last bot message
    const msgs = messagesEl.querySelectorAll('.msg.bot:not(.thinking)');
    const lastBot = msgs[msgs.length - 1];
    if (lastBot) {
        lastBot.after(container);
    } else {
        messagesEl.appendChild(container);
    }

    const labels = rows.map(r => r[config.labelCol]);
    const datasets = config.dataCols.map((colIdx, i) => ({
        label: columns[colIdx],
        data: rows.map(r => parseFloat(r[colIdx]) || 0),
        backgroundColor: config.type === 'pie'
            ? CHART_COLORS.slice(0, rows.length)
            : CHART_COLORS[i % CHART_COLORS.length] + '99',
        borderColor: CHART_COLORS[i % CHART_COLORS.length],
        borderWidth: config.type === 'pie' ? 1 : 2,
        tension: 0.3,
        fill: config.type === 'line' ? false : undefined,
    }));

    const isPie = config.type === 'pie' || config.type === 'doughnut';

    currentChart = new Chart(canvas, {
        type: config.type,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: isPie || datasets.length > 1,
                    position: isPie ? 'right' : 'top',
                    labels: { font: { size: 11, family: 'Inter' }, padding: 12 },
                },
                tooltip: {
                    backgroundColor: '#1a1a1a',
                    titleFont: { family: 'Inter', size: 12 },
                    bodyFont: { family: 'Inter', size: 11 },
                    cornerRadius: 8,
                    padding: 10,
                },
            },
            scales: isPie ? {} : {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11, family: 'Inter' }, maxRotation: 45 },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#f0f0f0' },
                    ticks: { font: { size: 11, family: 'Inter' } },
                },
            },
        },
    });

    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// =====================================================
// Export CSV / Excel
// =====================================================

function renderExportButtons(columns, rows, question, answer) {

    const bar = document.createElement('div');
    bar.className = 'export-bar';
    bar.innerHTML = '<button class="btn-export btn-csv">CSV</button>' +
                    '<button class="btn-export btn-excel">Excel</button>' +
                    '<button class="btn-export btn-pin">Pin to Dashboard</button>';

    // Insert after the last chart or last bot message
    const charts = messagesEl.querySelectorAll('.chart-container');
    const msgs = messagesEl.querySelectorAll('.msg.bot:not(.thinking)');
    const chart = charts.length ? charts[charts.length - 1] : null;
    const anchor = chart || msgs[msgs.length - 1];
    if (anchor) anchor.after(bar);
    else messagesEl.appendChild(bar);

    bar.querySelector('.btn-csv').addEventListener('click', () => exportCSV(columns, rows));
    bar.querySelector('.btn-excel').addEventListener('click', () => exportExcel(columns, rows));
    bar.querySelector('.btn-pin').addEventListener('click', () => {
        pinToDashboard(question || 'Query', columns, rows, answer || '', currentConvId || '');
        const pinBtn = bar.querySelector('.btn-pin');
        pinBtn.textContent = 'Pinned';
        pinBtn.disabled = true;
    });
}

function exportCSV(columns, rows) {
    const escape = v => {
        const s = String(v ?? '');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [columns.map(escape).join(',')];
    rows.forEach(r => lines.push(r.map(escape).join(',')));
    downloadFile(lines.join('\n'), 'askbase_export.csv', 'text/csv');
}

function exportExcel(columns, rows) {
    // Build a simple XLSX via a HTML table -> Blob trick (opens in Excel)
    let html = '<table><thead><tr>';
    columns.forEach(c => html += '<th>' + escapeHtml(c) + '</th>');
    html += '</tr></thead><tbody>';
    rows.forEach(r => {
        html += '<tr>';
        r.forEach(v => html += '<td>' + escapeHtml(String(v ?? '')) + '</td>');
        html += '</tr>';
    });
    html += '</tbody></table>';

    const blob = new Blob(
        ['\uFEFF' + html],
        { type: 'application/vnd.ms-excel;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'askbase_export.xls';
    a.click();
    URL.revokeObjectURL(url);
}

function downloadFile(content, filename, mime) {
    const blob = new Blob(['\uFEFF' + content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// =====================================================
// Token Usage Badge
// =====================================================

function renderTokenBadge(usage) {
    const badge = document.createElement('div');
    badge.className = 'token-badge';
    const total = (usage.total_tokens || 0).toLocaleString();
    const prompt = (usage.prompt_tokens || 0).toLocaleString();
    const completion = (usage.completion_tokens || 0).toLocaleString();
    const calls = usage.calls || 0;
    badge.innerHTML =
        '<span class="token-icon">&#9889;</span>' +
        '<span class="token-total">' + total + ' tokens</span>' +
        '<span class="token-detail">' + prompt + ' in / ' + completion + ' out &bull; ' + calls + ' calls</span>';

    // Insert after last bot message, chart, export bar, or data table
    const anchors = messagesEl.querySelectorAll('.msg.bot:not(.thinking), .chart-container, .export-bar, .data-table-wrap');
    const anchor = anchors.length ? anchors[anchors.length - 1] : null;
    if (anchor) anchor.after(badge);
    else messagesEl.appendChild(badge);
}

// =====================================================
// Dashboard
// =====================================================

let dashboardPins = JSON.parse(localStorage.getItem('askbase_dashboard') || '[]');

function saveDashboard() {
    localStorage.setItem('askbase_dashboard', JSON.stringify(dashboardPins));
}

function pinToDashboard(question, columns, rows, answer, convId) {
    dashboardPins.push({
        question,
        answer: answer || '',
        columns,
        rows: rows.slice(0, 200),
        convId: convId || '',
        time: Date.now(),
    });
    saveDashboard();
    renderDashboard();
}

function renderDashboard() {
    const grid = $('#dashboard-grid');
    const clearBtn = $('#dashboard-clear-btn');

    if (!dashboardPins.length) {
        grid.innerHTML = '<p style="color:#aaa;font-size:.8125rem">No pinned charts yet. Use "Pin to Dashboard" after a query result.</p>';
        clearBtn.style.display = 'none';
        return;
    }

    clearBtn.style.display = '';
    grid.innerHTML = '';

    dashboardPins.forEach((pin, idx) => {
        const card = document.createElement('div');
        card.className = 'dashboard-card';

        // Header with question + actions
        const header = document.createElement('div');
        header.className = 'dashboard-card-header';
        header.innerHTML = '<span class="dashboard-card-title">' + escapeHtml(pin.question) + '</span>' +
            '<div class="dashboard-card-actions">' +
                (pin.convId ? '<button class="dashboard-goto" title="Go to conversation">&#8599;</button>' : '') +
                '<button class="dashboard-remove" title="Remove">&times;</button>' +
            '</div>';
        card.appendChild(header);

        // Answer summary
        if (pin.answer) {
            const answerEl = document.createElement('div');
            answerEl.className = 'dashboard-card-answer';
            answerEl.innerHTML = formatBotMessage(pin.answer);
            card.appendChild(answerEl);
        }

        // Chart
        const chartWrap = document.createElement('div');
        chartWrap.className = 'dashboard-chart-wrap';
        const canvas = document.createElement('canvas');
        canvas.id = 'dash-chart-' + idx + '-' + Date.now();
        chartWrap.appendChild(canvas);
        card.appendChild(chartWrap);

        // Footer with metadata
        const footer = document.createElement('div');
        footer.className = 'dashboard-card-footer';
        const time = new Date(pin.time).toLocaleString();
        footer.innerHTML = '<span>' + pin.rows.length + ' rows &bull; ' + pin.columns.length + ' columns</span>' +
            '<span>' + time + '</span>';
        card.appendChild(footer);

        grid.appendChild(card);

        // Events
        header.querySelector('.dashboard-remove').addEventListener('click', () => {
            dashboardPins.splice(idx, 1);
            saveDashboard();
            renderDashboard();
        });

        const gotoBtn = header.querySelector('.dashboard-goto');
        if (gotoBtn && pin.convId) {
            gotoBtn.addEventListener('click', () => {
                if (conversations[pin.convId]) {
                    switchConversation(pin.convId);
                    switchNav('chat');
                }
            });
        }

        // Render chart
        const config = detectChartType(pin.columns, pin.rows);
        if (config) {
            const labels = pin.rows.map(r => r[config.labelCol]);
            const datasets = config.dataCols.map((colIdx, i) => ({
                label: pin.columns[colIdx],
                data: pin.rows.map(r => parseFloat(r[colIdx]) || 0),
                backgroundColor: config.type === 'pie'
                    ? CHART_COLORS.slice(0, pin.rows.length)
                    : CHART_COLORS[i % CHART_COLORS.length] + '99',
                borderColor: CHART_COLORS[i % CHART_COLORS.length],
                borderWidth: config.type === 'pie' ? 1 : 2,
                tension: 0.3,
                fill: config.type === 'line' ? false : undefined,
            }));
            const isPie = config.type === 'pie' || config.type === 'doughnut';
            new Chart(canvas, {
                type: config.type,
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: isPie || datasets.length > 1, position: isPie ? 'right' : 'top', labels: { font: { size: 10, family: 'Inter' }, padding: 8 } },
                    },
                    scales: isPie ? {} : {
                        x: { grid: { display: false }, ticks: { font: { size: 10, family: 'Inter' }, maxRotation: 45 } },
                        y: { beginAtZero: true, grid: { color: '#f0f0f0' }, ticks: { font: { size: 10, family: 'Inter' } } },
                    },
                },
            });
        } else {
            // No chart possible — show data table instead
            let html = '<table class="dash-table"><thead><tr>';
            pin.columns.forEach(c => html += '<th>' + escapeHtml(c) + '</th>');
            html += '</tr></thead><tbody>';
            pin.rows.slice(0, 10).forEach(r => {
                html += '<tr>';
                r.forEach(v => html += '<td>' + escapeHtml(String(v ?? '')) + '</td>');
                html += '</tr>';
            });
            html += '</tbody></table>';
            chartWrap.innerHTML = html;
        }
    });
}

$('#dashboard-clear-btn').addEventListener('click', () => {
    dashboardPins = [];
    saveDashboard();
    renderDashboard();
});

// Render on load
renderDashboard();

/* ===================================================
   MACHINE TIMER — app.js
   Real-time timer tracker backed by Supabase
   =================================================== */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://juesyugrdozfibwdsupu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NIaqex1976z_zs5EEVgKAg_SCh4BNla';
const TABLE             = 'machine_timers';

// ─── Machine Definitions ─────────────────────────────────────────────────────
const MACHINES = [
  { id: 'M1',     label: 'M1',     type: 'M',  hasBatch: false },
  { id: 'M2',     label: 'M2',     type: 'M',  hasBatch: false },
  { id: 'M3',     label: 'M3',     type: 'M',  hasBatch: false },
  { id: 'M4',     label: 'M4',     type: 'M',  hasBatch: false },
  { id: 'PP1',    label: 'PP1',    type: 'PP', hasBatch: true  },
  { id: 'PP2',    label: 'PP2',    type: 'PP', hasBatch: true  },
  { id: 'PP Old', label: 'PP Old', type: 'PP', hasBatch: true  },
];

// ─── State ───────────────────────────────────────────────────────────────────
let sb                   = null;   // Supabase client
let activeTimers         = {};     // { [machineId]: { id, start_time, batch_number } }
let tickIntervalId       = null;
let currentModalMachine  = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safe DOM id: replaces spaces with underscores */
const domId = machineId => 'mc_' + machineId.replace(/\s+/g, '_');

/** Format elapsed milliseconds → HH:MM:SS */
function formatElapsed(startISO) {
  const diffMs = Date.now() - new Date(startISO).getTime();
  if (diffMs < 0) return '00:00:00';
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const pad = n => String(n).padStart(2, '0');

/** Format ISO datetime for display */
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/** Get current local datetime string for <input type="datetime-local"> */
function localNowValue() {
  const now    = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

// ─── Supabase Init ───────────────────────────────────────────────────────────
function initSupabase() {
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  } catch (err) {
    console.error('[Supabase] Init failed:', err);
    return false;
  }
}

// ─── Data Operations ─────────────────────────────────────────────────────────

/** Load all currently active timers from the DB */
async function loadActiveTimers() {
  try {
    const { data, error } = await sb
      .from(TABLE)
      .select('id, machine_name, start_time, batch_number')
      .eq('is_running', true);

    if (error) throw error;

    activeTimers = {};
    (data || []).forEach(row => {
      activeTimers[row.machine_name] = {
        id:           row.id,
        start_time:   row.start_time,
        batch_number: row.batch_number,
      };
    });

    setConnBanner(true);
    updateAllCards();
  } catch (err) {
    console.error('[Load]', err);
    setConnBanner(false, err.message);
    showToast('⚠️ Could not load timers: ' + err.message, 'error');
  }
}

/** Start a new timer (stops existing one first) */
async function startTimer(machineId, startTimeLocal, batchNumber) {
  // Optimistic UI
  const tempKey = '__starting__' + machineId;

  try {
    // Stop any running timer for this machine
    if (activeTimers[machineId]) {
      await stopTimer(machineId, false);
    }

    const { data, error } = await sb
      .from(TABLE)
      .insert([{
        machine_name: machineId,
        start_time:   new Date(startTimeLocal).toISOString(),
        batch_number: batchNumber || null,
        is_running:   true,
      }])
      .select('id, machine_name, start_time, batch_number')
      .single();

    if (error) throw error;

    activeTimers[machineId] = {
      id:           data.id,
      start_time:   data.start_time,
      batch_number: data.batch_number,
    };

    updateCard(machineId);
    showToast(`✅ ${machineId} timer started`, 'success');
  } catch (err) {
    console.error('[Start]', err);
    showToast('❌ Start failed: ' + err.message, 'error');
  }
}

/** Stop an active timer */
async function stopTimer(machineId, notify = true) {
  const timer = activeTimers[machineId];
  if (!timer) return;

  try {
    const { error } = await sb
      .from(TABLE)
      .update({
        is_running:  false,
        stopped_at:  new Date().toISOString(),
      })
      .eq('id', timer.id);

    if (error) throw error;

    delete activeTimers[machineId];
    updateCard(machineId);

    if (notify) showToast(`⏹ ${machineId} timer stopped`, 'success');
  } catch (err) {
    console.error('[Stop]', err);
    showToast('❌ Stop failed: ' + err.message, 'error');
  }
}

// ─── Realtime Subscription ───────────────────────────────────────────────────
function subscribeRealtime() {
  if (!sb) return;

  sb.channel('rt_machine_timers')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE },
      ({ eventType, new: n, old: o }) => {
        if (eventType === 'INSERT' && n.is_running) {
          activeTimers[n.machine_name] = { id: n.id, start_time: n.start_time, batch_number: n.batch_number };
          updateCard(n.machine_name);
        } else if (eventType === 'UPDATE') {
          if (!n.is_running && activeTimers[n.machine_name]?.id === n.id) {
            delete activeTimers[n.machine_name];
            updateCard(n.machine_name);
          }
        } else if (eventType === 'DELETE') {
          if (activeTimers[o.machine_name]?.id === o.id) {
            delete activeTimers[o.machine_name];
            updateCard(o.machine_name);
          }
        }
      }
    )
    .subscribe(status => {
      console.log('[RT]', status);
      setConnBanner(status === 'SUBSCRIBED');
    });
}

// ─── UI Rendering ────────────────────────────────────────────────────────────

function renderApp() {
  const mMachines  = MACHINES.filter(m => m.type === 'M');
  const ppMachines = MACHINES.filter(m => m.type === 'PP');

  const root = document.getElementById('app-root');
  root.innerHTML = `
    <!-- Connection Banner -->
    <div class="conn-banner">
      <div class="conn-dot" id="conn-dot"></div>
      <span id="conn-text">Connecting to Supabase…</span>
    </div>

    <!-- Machine Filters Section -->
    <div class="section-header">
      <span class="section-label">Machine Filters</span>
      <div class="section-line"></div>
    </div>
    <div class="m-grid">
      ${mMachines.map(renderCardHTML).join('')}
    </div>

    <!-- PP Filters Section -->
    <div class="section-header">
      <span class="section-label">PP Filters</span>
      <div class="section-line"></div>
    </div>
    <div class="pp-grid">
      ${ppMachines.map(renderCardHTML).join('')}
    </div>
  `;
}

function renderCardHTML(machine) {
  const did   = domId(machine.id);
  const isPP  = machine.type === 'PP';
  return `
    <div class="machine-card ${isPP ? 'pp-card' : 'm-card'}" id="${did}">
      <div class="card-header">
        <div class="machine-badge${isPP ? ' pp-badge' : ''}">${machine.label}</div>
        <div class="status-chip" id="${did}_status">IDLE</div>
      </div>
      <div class="timer-display" id="${did}_timer">
        <span class="timer-idle">Not Running</span>
      </div>
      <div class="card-meta" id="${did}_meta"></div>
      <button class="btn btn-start${isPP ? ' pp-btn' : ''}"
              id="${did}_btn"
              aria-label="Start ${machine.label}">
        ▶ Start Timer
      </button>
    </div>
  `;
}

function updateAllCards() {
  MACHINES.forEach(m => updateCard(m.id));
}

function updateCard(machineId) {
  const did     = domId(machineId);
  const card    = document.getElementById(did);
  const timerEl = document.getElementById(`${did}_timer`);
  const statusEl= document.getElementById(`${did}_status`);
  const metaEl  = document.getElementById(`${did}_meta`);
  const btn     = document.getElementById(`${did}_btn`);

  if (!card) return;

  const machine = MACHINES.find(m => m.id === machineId);
  const timer   = activeTimers[machineId];
  const isPP    = machine.type === 'PP';

  if (timer) {
    // ── Running state ──
    card.classList.add('running');
    timerEl.innerHTML = `<span class="timer-running">${formatElapsed(timer.start_time)}</span>`;
    statusEl.textContent = 'RUNNING';
    statusEl.className   = 'status-chip running';

    let metaHTML = `
      <div class="meta-row">📅 <strong>${fmtDate(timer.start_time)}</strong></div>
    `;
    if (machine.hasBatch && timer.batch_number) {
      metaHTML += `<div class="batch-chip">📦 ${timer.batch_number}</div>`;
    }
    metaEl.innerHTML = metaHTML;

    btn.className      = 'btn btn-stop';
    btn.textContent    = '⏹ Stop Timer';
    btn.setAttribute('aria-label', `Stop ${machine.label}`);
    btn.onclick        = () => stopTimer(machineId);

  } else {
    // ── Idle state ──
    card.classList.remove('running');
    timerEl.innerHTML = `<span class="timer-idle">Not Running</span>`;
    statusEl.textContent = 'IDLE';
    statusEl.className   = 'status-chip';
    metaEl.innerHTML     = '';

    btn.className   = `btn btn-start${isPP ? ' pp-btn' : ''}`;
    btn.textContent = '▶ Start Timer';
    btn.setAttribute('aria-label', `Start ${machine.label}`);
    btn.onclick     = () => openModal(machineId);
  }
}

// ─── Clock Tick (every second) ───────────────────────────────────────────────
function tick() {
  // Live timer updates
  MACHINES.forEach(m => {
    const timer = activeTimers[m.id];
    if (!timer) return;
    const el = document.getElementById(`${domId(m.id)}_timer`);
    if (el) el.innerHTML = `<span class="timer-running">${formatElapsed(timer.start_time)}</span>`;
  });

  // Header clock
  const cl = document.getElementById('live-clock');
  if (cl) cl.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function openModal(machineId) {
  const machine = MACHINES.find(m => m.id === machineId);
  currentModalMachine = machineId;

  const overlay    = document.getElementById('modal-overlay');
  const sheet      = document.getElementById('modal-sheet');
  const icon       = document.getElementById('modal-icon');
  const batchGroup = document.getElementById('batch-group');
  const dtInput    = document.getElementById('modal-datetime');
  const btInput    = document.getElementById('modal-batch');

  document.getElementById('modal-title').textContent    = `Start ${machine.label}`;
  document.getElementById('modal-subtitle').textContent = machine.hasBatch
    ? 'Set start time and batch number'
    : 'Set the start date & time';

  dtInput.value = localNowValue();

  if (machine.hasBatch) {
    batchGroup.style.display = 'block';
    btInput.value = '';
    sheet.classList.add('pp-modal');
    icon.style.background = 'var(--pp-grad)';
  } else {
    batchGroup.style.display = 'none';
    sheet.classList.remove('pp-modal');
    icon.style.background = 'var(--m-grad)';
  }

  overlay.classList.add('active');
  // Focus after animation
  setTimeout(() => dtInput.focus(), 450);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
  currentModalMachine = null;
}

// Global — called by HTML onclick
function handleModalStart() {
  const dtVal   = document.getElementById('modal-datetime').value;
  const btVal   = document.getElementById('modal-batch')?.value?.trim() ?? '';
  const machine = MACHINES.find(m => m.id === currentModalMachine);

  if (!machine) {
    showToast('⚠️ No machine selected', 'error');
    return;
  }
  if (!dtVal) {
    showToast('⚠️ Please select a date and time', 'error');
    return;
  }
  if (machine.hasBatch && !btVal) {
    showToast('⚠️ Please enter a batch number', 'error');
    return;
  }

  // ⚠️ Capture BEFORE closeModal() — closeModal sets currentModalMachine = null
  const machineId    = currentModalMachine;
  const batchNumber  = machine.hasBatch ? btVal : null;

  closeModal();
  startTimer(machineId, dtVal, batchNumber);
}

// ─── Connection Banner ───────────────────────────────────────────────────────
function setConnBanner(ok, errMsg = '') {
  const dot = document.getElementById('conn-dot');
  const txt = document.getElementById('conn-text');
  if (!dot) return;
  dot.className = `conn-dot ${ok ? 'ok' : 'fail'}`;
  txt.textContent = ok ? 'Supabase — Connected ✓' : `Disconnected: ${errMsg}`;
}

// ─── Toasts ──────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className   = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ─── Boot ────────────────────────────────────────────────────────────────────
async function init() {
  // Start clock immediately
  tick();

  // Render skeleton UI
  renderApp();
  updateAllCards(); // all idle initially

  // Modal close on outside click
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Init Supabase
  if (!initSupabase()) {
    setConnBanner(false, 'Client initialization failed');
    return;
  }

  // Load data then subscribe
  await loadActiveTimers();
  subscribeRealtime();

  // Kick off local tick
  tickIntervalId = setInterval(tick, 1000);
}

document.addEventListener('DOMContentLoaded', init);

(() => {
  'use strict';

  const CONFIG_KEY = 'climate-config-v1';
  const DEFAULTS = { place: 'Kongsberg', lat: 59.6689, lon: 9.6502, sensorUrl: '' };
  const OUTDOOR_EVERY_MS = 10 * 60 * 1000;   // yr.no asks clients not to poll too often
  const INDOOR_EVERY_MS = 10 * 1000;
  const STALE_AFTER_MS = 60 * 1000;          // indoor reading older than this is shown as stale
  const DEMO = new URLSearchParams(location.search).has('demo'); // ?demo = simulated indoor data + fake workout history
  const WORKOUT_TYPES = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body'];
  const WORKOUT_KEEP = 100;                  // newest days kept in storage (more than a month)
  const WORKOUT_KEY = DEMO ? 'climate-workout-demo-v1' : 'climate-workout-v1'; // stored on this device
  const FORECAST_KEY = 'climate-forecast-v1'; // last good yr.no forecast, shown when offline
  const FORECAST_KEEP = 48;                  // hourly entries saved (the page uses about 24)

  const $ = (id) => document.getElementById(id);
  const clockTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // ---------- config ----------
  function loadConfig() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function saveConfig(c) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
  }
  let cfg = loadConfig();

  // ---------- tabs & clock ----------
  const PAGE_TITLES = { outdoor: 'Outdoor', indoor: 'Indoor', workout: 'Workout' };
  function showPage(name) {
    document.querySelectorAll('[role=tab]').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.page === name)));
    document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== name; });
    $('pageTitle').textContent = PAGE_TITLES[name] ?? name;
    $('pageTitle').closest('.shell').scrollTop = 0;
  }
  document.querySelectorAll('[role=tab]').forEach((b) =>
    b.addEventListener('click', () => showPage(b.dataset.page)));

  function tickClock() {
    const now = new Date();
    $('clock').textContent = clockTime(now);
    $('today').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }
  tickClock();
  setInterval(tickClock, 15 * 1000);

  // ---------- fullscreen ----------
  // Installed from the home screen the app already runs fullscreen (see the manifest), so the status and
  // navigation bars hide themselves and a swipe from the screen edge shows them briefly. Opened in an
  // ordinary browser tab, or installed before that setting existed, this button does the same.
  const fullscreenBtn = $('fullscreenBtn');
  if (document.fullscreenEnabled && !matchMedia('(display-mode: fullscreen)').matches) {
    fullscreenBtn.hidden = false;
    fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* refused: needs a tap */ });
    });
    document.addEventListener('fullscreenchange', () => {
      fullscreenBtn.querySelector('span').textContent = document.fullscreenElement ? 'Exit' : 'Fullscreen';
    });
  }

  // ---------- formatting helpers ----------
  const fmt = (v, digits = 0) =>
    (v === null || v === undefined || Number.isNaN(Number(v))) ? '—' : Number(v).toFixed(digits);

  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];

  // yr.no symbol codes -> emoji and text
  const SYMBOL_LABELS = {
    clearsky: 'Clear sky', fair: 'Fair', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy',
    fog: 'Fog', lightrain: 'Light rain', rain: 'Rain', heavyrain: 'Heavy rain',
    lightsnow: 'Light snow', snow: 'Snow', heavysnow: 'Heavy snow', sleet: 'Sleet',
    lightsleet: 'Light sleet', heavysleet: 'Heavy sleet', thunder: 'Thunder',
  };
  function symbolBase(code = '') { return code.replace(/_(day|night|polartwilight)$/, ''); }
  function symbolLabel(code = '') {
    const base = symbolBase(code);
    return SYMBOL_LABELS[base] ?? (base ? base.replace(/([a-z])(?=[a-z]*$)/g, '$1') : 'No data');
  }
  function symbolEmoji(code = '') {
    const night = code.endsWith('_night');
    const c = symbolBase(code);
    if (!c) return '·';
    if (c.includes('thunder')) return '⛈️';
    if (c.includes('snow')) return '❄️';
    if (c.includes('sleet')) return '🌨️';
    if (c.includes('rain')) return c.startsWith('light') ? '🌦️' : '🌧️';
    if (c === 'fog') return '🌫️';
    if (c === 'cloudy') return '☁️';
    if (c === 'partlycloudy') return night ? '☁️' : '⛅';
    if (c === 'fair') return night ? '🌙' : '🌤️';
    if (c === 'clearsky') return night ? '🌙' : '☀️';
    return '·';
  }

  // background of the outdoor hero card: day/night/weather
  function skyFor(code = '') {
    const c = symbolBase(code);
    if (!c) return 'none';
    if (/rain|thunder|sleet/.test(c)) return 'rain';
    if (c.includes('snow')) return 'snow';
    if (c === 'fog') return 'fog';
    if (c === 'cloudy') return 'cloudy';
    return code.endsWith('_night') ? 'night' : 'clear'; // clearsky, fair, partlycloudy
  }

  // ---------- outdoor: yr.no / MET Norway locationforecast ----------
  async function loadOutdoor() {
    $('placeName').textContent = cfg.place;
    try {
      const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact' +
        `?lat=${Number(cfg.lat).toFixed(4)}&lon=${Number(cfg.lon).toFixed(4)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`yr.no answered HTTP ${res.status}`);
      const json = await res.json();
      renderOutdoor(json);
      saveForecast(json);
      $('outStatus').textContent =
        `Updated ${clockTime(new Date())} · Weather data: MET Norway / yr.no (CC BY 4.0)`;
    } catch (e) {
      // offline or yr.no unreachable: fall back to the last saved forecast, if it still applies
      const saved = readForecast();
      if (saved) {
        renderOutdoor(saved.json);
        $('outStatus').textContent =
          `Offline. Showing the forecast saved at ${clockTime(new Date(saved.at))} (${e.message})`;
      } else {
        $('outStatus').textContent = `Could not load yr.no forecast: ${e.message}`;
      }
    }
  }

  const sameSpot = (a, b) => Number(a).toFixed(4) === Number(b).toFixed(4);

  function saveForecast(json) {
    const keep = { properties: { timeseries: json.properties.timeseries.slice(0, FORECAST_KEEP) } };
    try {
      localStorage.setItem(FORECAST_KEY, JSON.stringify({ at: Date.now(), lat: cfg.lat, lon: cfg.lon, json: keep }));
    } catch { /* storage unavailable */ }
  }

  // The saved forecast for the current location, without hours that have already passed.
  function readForecast() {
    try {
      const s = JSON.parse(localStorage.getItem(FORECAST_KEY) || 'null');
      if (!s || !sameSpot(s.lat, cfg.lat) || !sameSpot(s.lon, cfg.lon)) return null;
      const ts = s.json.properties.timeseries.filter((t) => new Date(t.time).getTime() > Date.now() - 3600 * 1000);
      return ts.length ? { at: s.at, json: { properties: { timeseries: ts } } } : null;
    } catch {
      return null;
    }
  }

  function setTile(id, value, suffix = '') {
    $(id).textContent = value === '—' ? '—' : `${value} ${suffix}`.trim();
  }

  function renderOutdoor(json) {
    const ts = json.properties.timeseries;
    const now = ts[0];
    const d = now.data.instant.details;
    const next1 = now.data.next_1_hours;
    const code = next1?.summary?.symbol_code ?? now.data.next_6_hours?.summary?.symbol_code ?? '';

    $('outTemp').textContent = fmt(d.air_temperature, 1);
    $('outSymbol').textContent = symbolLabel(code);
    $('outIcon').textContent = symbolEmoji(code);
    $('hero').dataset.sky = skyFor(code);

    // high / low over the next 24 hours
    const horizon = new Date(now.time).getTime() + 24 * 3600 * 1000;
    const temps24 = ts.filter((t) => new Date(t.time).getTime() <= horizon)
      .map((t) => t.data.instant.details.air_temperature).filter(Number.isFinite);
    $('outHiLo').textContent = temps24.length
      ? `High ${fmt(Math.max(...temps24), 0)}° · Low ${fmt(Math.min(...temps24), 0)}°` : '';

    setTile('tHum', fmt(d.relative_humidity, 0), '%');
    $('tDew').textContent = Number.isFinite(d.air_temperature) && Number.isFinite(d.relative_humidity)
      ? `Dew point ${fmt(dewPoint(d.air_temperature, d.relative_humidity), 0)}°` : '';
    setTile('tWind', fmt(d.wind_speed, 1), 'm/s');
    const hasDir = d.wind_from_direction != null;
    $('tWindDir').textContent = hasDir ? `from ${compass(d.wind_from_direction)}` : '';
    $('windArrow').classList.toggle('on', hasDir);
    if (hasDir) $('windArrow').style.transform = `rotate(${d.wind_from_direction}deg)`; // points where the wind blows to
    setTile('tPress', fmt(d.air_pressure_at_sea_level, 0), 'hPa');
    setTile('tRain', next1?.details ? fmt(next1.details.precipitation_amount, 1) : '—', 'mm');

    // next 12 hours (entries that carry a 1-hour forecast); bar height shows the temperature
    const rows = ts.filter((t) => t.data.next_1_hours).slice(0, 12);
    const temps = rows.map((t) => t.data.instant.details.air_temperature);
    const lo = Math.min(...temps), span = Math.max(Math.max(...temps) - lo, 1);
    $('hourly').replaceChildren(...rows.map((t, i) => {
      const cell = document.createElement('div');
      cell.className = 'col';
      const hour = new Date(t.time).toLocaleTimeString([], { hour: '2-digit' });
      const sym = t.data.next_1_hours.summary?.symbol_code ?? '';
      const precip = t.data.next_1_hours.details?.precipitation_amount ?? 0;
      cell.innerHTML =
        '<div class="h"></div><div class="i"></div><div class="bars"><div class="tbar"></div></div><div class="t"></div><div class="p"></div>';
      cell.querySelector('.h').textContent = i === 0 ? 'Now' : hour;
      cell.querySelector('.i').textContent = symbolEmoji(sym);
      cell.querySelector('.tbar').style.height = `${8 + ((temps[i] - lo) / span) * 40}px`;
      cell.querySelector('.t').textContent = `${fmt(temps[i], 0)}°`;
      cell.querySelector('.p').textContent = precip > 0 ? `${fmt(precip, 1)} mm` : '';
      return cell;
    }));
  }

  // ---------- indoor: STM32 over Wi-Fi ----------
  // Expected JSON from the STM32:  {"temperature": 21.4, "humidity": 45.2}
  // Must be served with header: Access-Control-Allow-Origin: *
  let lastIndoor = null; // { t, h, at }

  function dewPoint(t, rh) {
    const g = Math.log(rh / 100) + (17.62 * t) / (243.12 + t);
    return (243.12 * g) / (17.62 - g);
  }

  async function pollIndoor() {
    if (DEMO) {
      const s = Date.now() / 60000;
      lastIndoor = { t: 21 + Math.sin(s) * 1.5, h: 45 + Math.cos(s) * 8, at: Date.now() };
      return renderIndoor(`Demo data · ${clockTime(new Date())}`);
    }
    if (!cfg.sensorUrl) {
      lastIndoor = null;
      return renderIndoor('No STM32 address set. Open Settings to add it.');
    }
    try {
      const options = { cache: 'no-store' };
      if (isHomeNetworkAddress(cfg.sensorUrl)) options.targetAddressSpace = 'local';
      const res = await fetch(cfg.sensorUrl, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const t = Number(j.temperature), h = Number(j.humidity);
      if (!Number.isFinite(t) || !Number.isFinite(h)) throw new Error('bad data from sensor');
      lastIndoor = { t, h, at: Date.now() };
      renderIndoor(`Live from sensor · ${clockTime(new Date())}`);
    } catch (e) {
      const hint = location.protocol === 'https:'
        ? ' Check the address, and that Chrome allows Local network access for this site.' : '';
      renderIndoor(`Sensor unreachable (${e.message}).${hint} Showing last reading.`);
    }
  }

  // This page is served over HTTPS, and the sensor speaks plain HTTP. Chrome only allows that when
  // the request is marked as going to the local network ("Local network access"; it asks the user once).
  function isHomeNetworkAddress(url) {
    try {
      const host = new URL(url).hostname;
      return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) || host.endsWith('.local');
    } catch {
      return false;
    }
  }

  const RING_ARC = 377; // length of the 270-degree gauge arc, matches stroke-dasharray in styles.css
  function setRing(id, fraction) {
    $(id).style.strokeDasharray = `${Math.min(1, Math.max(0, fraction)) * RING_ARC} 503`;
  }
  function setIndoorState(state, text) {
    $('inPill').dataset.state = state; // none | live | stale
    $('inStatus').textContent = text;
  }

  function renderIndoor(statusText) {
    if (!lastIndoor) {
      setIndoorState('none', statusText);
      $('inTemp').textContent = '--';
      $('inHum').textContent = '--';
      $('dew').textContent = '--';
      $('tempNote').textContent = '—';
      $('humNote').textContent = '—';
      setRing('inTempRing', 0);
      setRing('inHumRing', 0);
      for (const id of ['inTempCard', 'inHumCard']) {
        $(id).dataset.tone = 'none';
        $(id).classList.remove('stale');
      }
      return;
    }
    const { t, h, at } = lastIndoor;
    const stale = Date.now() - at > STALE_AFTER_MS;
    $('inTemp').textContent = fmt(t, 1);
    $('inHum').textContent = fmt(h, 0);
    $('dew').textContent = fmt(dewPoint(t, h), 1);
    setRing('inTempRing', (t - 10) / 25);   // gauge scale 10-35 C
    setRing('inHumRing', h / 100);          // gauge scale 0-100 %
    // comfort bands: temperature 19-24 C, humidity 30-60 %
    $('inTempCard').dataset.tone = t < 19 ? 'cool' : t <= 24 ? 'good' : 'warn';
    $('tempNote').textContent = t < 19 ? 'Cool' : t <= 24 ? 'Comfortable' : 'Warm';
    $('inHumCard').dataset.tone = h < 30 ? 'warn' : h <= 60 ? 'good' : 'bad';
    $('humNote').textContent = h < 30 ? 'Dry' : h <= 60 ? 'Comfortable' : 'Humid';
    $('inTempCard').classList.toggle('stale', stale);
    $('inHumCard').classList.toggle('stale', stale);
    setIndoorState(stale ? 'stale' : 'live', stale ? `No new reading since ${clockTime(new Date(at))}` : statusText);
  }

  // ---------- workout log ----------
  // One workout per day, no time of day. Stored as { "YYYY-MM-DD": "Push", ... }, newest
  // WORKOUT_KEEP days kept.
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function cleanWorkouts(input) {
    const days = {};
    if (Array.isArray(input)) {
      // older format: [{ t: epochMs, type }] -> keep the last entry of each day, drop the time
      input.filter((w) => w && Number.isFinite(w.t) && WORKOUT_TYPES.includes(w.type))
        .sort((a, b) => a.t - b.t)
        .forEach((w) => { days[dayKey(new Date(w.t))] = w.type; });
    } else if (input && typeof input === 'object') {
      for (const [k, v] of Object.entries(input)) {
        if (DAY_RE.test(k) && WORKOUT_TYPES.includes(v)) days[k] = v;
      }
    }
    return Object.fromEntries(Object.keys(days).sort().slice(-WORKOUT_KEEP).map((k) => [k, days[k]]));
  }

  function loadWorkouts() {
    try {
      const raw = localStorage.getItem(WORKOUT_KEY);
      if (raw) return cleanWorkouts(JSON.parse(raw));
    } catch { /* fall through */ }
    return DEMO ? seedDemoWorkouts() : {};
  }

  function seedDemoWorkouts() {
    const days = {};
    for (let i = 40; i >= 1; i--) {
      if (Math.random() < 0.45) continue; // rest days
      const d = new Date(); d.setDate(d.getDate() - i);
      days[dayKey(d)] = WORKOUT_TYPES[Math.floor(Math.random() * WORKOUT_TYPES.length)];
    }
    return saveWorkouts(days);
  }

  let workouts = {};
  workouts = loadWorkouts(); // after the declaration: seeding the demo history assigns `workouts` too

  // Workouts live on this device only (browser storage); there is no server. Settings has a backup file
  // for copying them elsewhere.
  function saveWorkouts(days) {
    workouts = cleanWorkouts(days);
    let saved = true;
    try { localStorage.setItem(WORKOUT_KEY, JSON.stringify(workouts)); } catch { saved = false; }
    setWorkoutStatus(saved);
    return workouts;
  }

  const BACKUP_KEY = 'climate-backup-v1'; // when the last backup file was made (epoch ms)
  function lastBackupText() {
    let at = 0;
    try { at = Number(localStorage.getItem(BACKUP_KEY)) || 0; } catch { /* storage unavailable */ }
    return at
      ? `Last backup: ${new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' })}.`
      : 'No backup yet (Settings → Back up).';
  }

  function setWorkoutStatus(saved = true) {
    $('workoutStatus').textContent = DEMO ? 'Demo data: kept in this browser only.'
      : saved ? `Saved on this tablet. ${lastBackupText()}`
      : 'Could not save: browser storage is unavailable.';
  }

  // ---- backup file: workouts + settings as JSON ----
  function exportBackup() {
    const data = { app: 'climate', version: 1, exportedAt: new Date().toISOString(), settings: cfg, workouts };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    link.download = `climate-backup-${dayKey(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* storage unavailable */ }
    setWorkoutStatus(true);
    $('backupMsg').textContent = 'Backup file saved (look in Downloads).';
  }

  function cleanConfig(s) {
    if (!s || typeof s !== 'object') return null;
    const lat = Number(s.lat), lon = Number(s.lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
    return {
      place: String(s.place ?? '').trim().slice(0, 40) || DEFAULTS.place,
      lat, lon,
      sensorUrl: typeof s.sensorUrl === 'string' ? s.sensorUrl.trim() : '',
    };
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      const incoming = cleanWorkouts(data.workouts ?? data);  // also accepts a bare workouts object
      const settings = cleanConfig(data.settings);
      const count = Object.keys(incoming).length;
      if (!count && !settings) throw new Error('no workouts or settings found in that file');
      saveWorkouts({ ...workouts, ...incoming });              // days in the file replace the same days here
      if (settings) { cfg = settings; saveConfig(cfg); loadOutdoor(); pollIndoor(); }
      renderWorkouts();
      $('backupMsg').textContent = `Restored ${count} workout day${count === 1 ? '' : 's'}${settings ? ' and the settings' : ''}.`;
    } catch (e) {
      $('backupMsg').textContent = `Could not restore: ${e.message}`;
    }
  }

  // The day the type buttons apply to; picked in the calendar, today by default.
  let selectedDay = null;

  function setWorkout(key, type) {
    saveWorkouts({ ...workouts, [key]: type });
    renderWorkouts();
  }
  function clearWorkout(key) {
    const { [key]: _removed, ...rest } = workouts;
    saveWorkouts(rest);
    renderWorkouts();
  }

  const typeButtons = WORKOUT_TYPES.map((type) => {
    const b = document.createElement('button');
    b.className = 'type-btn';
    b.dataset.type = type;
    b.innerHTML = '<i class="dot"></i><span></span>';
    b.lastChild.textContent = type;
    b.addEventListener('click', () => setWorkout(selectedDay, type));
    $('workoutTypes').appendChild(b);
    return b;
  });
  $('dayClear').addEventListener('click', () => clearWorkout(selectedDay));

  function renderWorkouts() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const todayKey = dayKey(now);
    const monthPrefix = `${y}-${pad2(m + 1)}-`;
    if (!selectedDay || !selectedDay.startsWith(monthPrefix) || selectedDay > todayKey) selectedDay = todayKey;

    // counters; weeks run Monday to Sunday
    const weekStartKey = dayKey(new Date(y, m, now.getDate() - ((now.getDay() + 6) % 7)));
    const keys = Object.keys(workouts);
    $('wkWeek').textContent = keys.filter((k) => k >= weekStartKey && k <= todayKey).length;
    $('wkMonth').textContent = keys.filter((k) => k.startsWith(monthPrefix)).length;

    renderDayPanel(todayKey);
    renderCalendar(y, m, todayKey);
  }

  // Panel for the selected day: which workout it has, and the buttons to set or clear it.
  function renderDayPanel(todayKey) {
    const [sy, sm, sd] = selectedDay.split('-').map(Number);
    const date = new Date(sy, sm - 1, sd);
    const yesterdayKey = dayKey(new Date(sy, sm - 1, sd + 1));
    $('dayLabel').textContent = selectedDay === todayKey ? 'Today'
      : yesterdayKey === todayKey ? 'Yesterday' : 'Log for';
    $('dayTitle').textContent = date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    const current = workouts[selectedDay];
    typeButtons.forEach((b) => {
      const on = b.dataset.type === current;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('dayClear').hidden = !current;
  }

  // Month grid (Monday first) for the current month: each day shows its workout, if any.
  // Tapping a past day (or today) selects it; days still to come are disabled.
  function renderCalendar(y, m, todayKey) {
    $('calTitle').textContent = new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
    const cells = [];
    for (let i = (new Date(y, m, 1).getDay() + 6) % 7; i > 0; i--) cells.push(document.createElement('div'));
    for (let d = 1, n = new Date(y, m + 1, 0).getDate(); d <= n; d++) {
      const date = new Date(y, m, d);
      const key = dayKey(date);
      const type = workouts[key];
      const cell = document.createElement('button');
      cell.className = 'cal-day' + (key === todayKey ? ' today' : '') + (key === selectedDay ? ' selected' : '');
      cell.disabled = key > todayKey;
      cell.setAttribute('aria-pressed', String(key === selectedDay));
      cell.setAttribute('aria-label',
        `${date.toLocaleDateString([], { day: 'numeric', month: 'long' })}: ${type ?? 'no workout'}`);
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = d;
      cell.appendChild(num);
      if (type) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.dataset.type = type;
        chip.textContent = type;
        cell.appendChild(chip);
      }
      cell.addEventListener('click', () => { selectedDay = key; renderWorkouts(); });
      cells.push(cell);
    }
    $('calGrid').replaceChildren(...cells);
  }

  // keep "today", the week and the month correct if the tablet stays on across midnight
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderWorkouts(); });
  setInterval(renderWorkouts, 60 * 1000);

  // ---------- settings ----------
  const dlg = $('settings');
  const form = $('settingsForm');

  $('settingsBtn').addEventListener('click', () => {
    form.place.value = cfg.place;
    form.lat.value = cfg.lat;
    form.lon.value = cfg.lon;
    form.sensorUrl.value = cfg.sensorUrl;
    $('geoMsg').textContent = '';
    $('backupMsg').textContent = '';
    dlg.showModal();
  });

  $('exportBtn').addEventListener('click', exportBackup);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';           // so picking the same file again still fires
    if (file) importBackup(file);
  });

  $('useGeo').addEventListener('click', () => {
    if (!navigator.geolocation) { $('geoMsg').textContent = 'Location not available here.'; return; }
    $('geoMsg').textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      (p) => {
        form.lat.value = p.coords.latitude.toFixed(4);
        form.lon.value = p.coords.longitude.toFixed(4);
        $('geoMsg').textContent = 'Location set.';
      },
      () => { $('geoMsg').textContent = 'Location not allowed or unavailable. Type coordinates instead.'; },
      { timeout: 10000 }
    );
  });

  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const lat = parseFloat(form.lat.value);
    const lon = parseFloat(form.lon.value);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return;
    cfg = {
      place: form.place.value.trim() || DEFAULTS.place,
      lat,
      lon,
      sensorUrl: form.sensorUrl.value.trim(),
    };
    saveConfig(cfg);
    loadOutdoor();
    pollIndoor();
  });

  // ---------- start ----------
  renderWorkouts();
  setWorkoutStatus();
  if (!DEMO) navigator.storage?.persist?.()?.catch(() => {}); // ask the browser not to clear this data
  if (new URLSearchParams(location.search).has('workout')) showPage('workout');

  // show the last saved forecast straight away; loadOutdoor() replaces it once yr.no answers
  const savedForecast = readForecast();
  if (savedForecast) {
    $('placeName').textContent = cfg.place;
    renderOutdoor(savedForecast.json);
    $('outStatus').textContent = `Showing the forecast saved at ${clockTime(new Date(savedForecast.at))}. Updating…`;
  }
  loadOutdoor();
  setInterval(loadOutdoor, OUTDOOR_EVERY_MS);
  pollIndoor();
  setInterval(pollIndoor, INDOOR_EVERY_MS);
  setInterval(() => { if (lastIndoor) renderIndoor($('inStatus').textContent); }, 5000);

  // offline support + automatic updates (see sw.js); needs HTTPS or localhost
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* not available here; the app still works online */ });
  }
})();

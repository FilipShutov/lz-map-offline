/* LZ Репитери офлайн — offline map + list of Bulgarian amateur radio repeaters.
 * Data source: api.varna.radio (same data as lz-map.org). Bundled at build time,
 * refreshed automatically when the phone is online. */
(function () {
  'use strict';

  var API_URL = 'https://api.varna.radio/v1/';
  var CACHE_KEY = 'lz.repeaters.v1';

  var MODES = [
    { id: 'all', label: 'Всички', color: null },
    { id: 'analog', label: 'Analog', color: '#2e7d32' },
    { id: 'dmr', label: 'DMR', color: '#1565c0' },
    { id: 'dstar', label: 'D-Star', color: '#c62828' },
    { id: 'fusion', label: 'Fusion', color: '#7b1fa2' },
    { id: 'nxdn', label: 'NXDN', color: '#ef6c00' },
    { id: 'parrot', label: 'Parrot', color: '#546e7a' }
  ];
  var MODE_COLOR = {};
  MODES.forEach(function (m) { MODE_COLOR[m.id] = m.color; });

  var state = {
    repeaters: [],
    dataDate: null,
    dataSource: '',
    filter: 'all',
    query: '',
    me: null,           // {lat, lng, acc}
    markers: {},        // callsign -> L.circleMarker
    coverage: {},       // manifest
    coverageLayer: null,
    coverageCall: null,
    meta: { maxzoom: 14 }
  };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function stripHtml(s) {
    var d = new DOMParser().parseFromString(String(s || ''), 'text/html');
    return (d.body.textContent || '').trim();
  }
  function mhz(hz) { return (typeof hz === 'number' && hz > 0) ? (hz / 1e6).toFixed(4) : null; }
  function fmtDate(d) {
    if (!d) return '—';
    var x = new Date(d);
    if (isNaN(x)) return '—';
    return x.toLocaleDateString('bg-BG') + ' ' + x.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  }
  function haversineKm(a, b) {
    var R = 6371, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    var toR = Math.PI / 180;
    var y = Math.sin((b.lng - a.lng) * toR) * Math.cos(b.lat * toR);
    var x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) -
      Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lng - a.lng) * toR);
    var deg = (Math.atan2(y, x) / toR + 360) % 360;
    var dirs = ['С', 'СИ', 'И', 'ЮИ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    return { deg: Math.round(deg), dir: dirs[Math.round(deg / 45) % 8] };
  }

  // ---------- data normalisation ----------
  function modesOf(r) {
    var m = r.modes || {}, out = [];
    function on(k) { return m[k] && m[k].enabled; }
    if (on('fm') || on('am') || on('usb') || on('lsb')) out.push('analog');
    ['dmr', 'dstar', 'fusion', 'nxdn', 'parrot'].forEach(function (k) { if (on(k)) out.push(k); });
    return out;
  }
  function normalise(list) {
    return list
      .filter(function (r) { return r && !r.disabled && typeof r.latitude === 'number' && typeof r.longitude === 'number'; })
      .map(function (r) {
        var f = r.freq || {};
        var tone = typeof f.tone === 'number' ? f.tone : f.ctcss;
        var rec = {
          raw: r,
          call: r.callsign,
          lat: r.latitude,
          lng: r.longitude,
          place: r.place || '',
          location: r.location || '',
          out: mhz(f.tx),          // repeater transmits -> you listen here
          inp: mhz(f.rx),          // repeater listens -> you transmit here
          shift: (typeof f.tx === 'number' && typeof f.rx === 'number' && f.tx && f.rx) ? ((f.rx - f.tx) / 1e6) : null,
          tone: (typeof tone === 'number' && tone > 0) ? tone : null,
          channel: f.channel != null ? String(f.channel).trim() : '',
          modes: modesOf(r)
        };
        rec.search = [rec.call, rec.place, rec.location, rec.out, rec.inp, rec.channel, r.keeper, r.qth]
          .join(' ').toLowerCase();
        return rec;
      })
      .sort(function (a, b) { return a.call.localeCompare(b.call); });
  }

  function loadJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function setData(list, date, source) {
    state.repeaters = normalise(list);
    state.dataDate = date;
    state.dataSource = source;
    drawMarkers();
    renderList();
  }

  function loadBundled() {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { cached = null; }
    return loadJSON('data/repeaters.json').catch(function () { return null; }).then(function (bundled) {
      var bundledDate = state.meta.built || null;
      if (cached && cached.list && (!bundledDate || new Date(cached.date) > new Date(bundledDate))) {
        setData(cached.list, cached.date, 'обновени онлайн');
      } else if (bundled) {
        setData(bundled, bundledDate, 'вградени в приложението');
      } else if (cached && cached.list) {
        setData(cached.list, cached.date, 'обновени онлайн');
      }
    });
  }

  function refreshOnline() {
    if (!navigator.onLine) return;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 10000);
    fetch(API_URL, ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (list) {
        clearTimeout(t);
        if (!Array.isArray(list) || list.length < 10) return;
        var now = new Date().toISOString();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ date: now, list: list })); } catch (e) { /* storage full */ }
        setData(list, now, 'обновени онлайн');
      })
      .catch(function () { clearTimeout(t); });
  }

  // ---------- map ----------
  var map = L.map('map', {
    zoomControl: false,
    minZoom: 6,
    maxZoom: 17,
    maxBounds: [[39.8, 20.5], [45.6, 30.5]],
    maxBoundsViscosity: 0.8,
    attributionControl: true
  }).setView([42.75, 25.3], 7);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('© OpenStreetMap · Protomaps · данни: varna.radio / lz-map.org');

  var meLayer = L.layerGroup().addTo(map);
  var rptLayer = L.layerGroup().addTo(map);

  function addBaseLayer() {
    if (typeof protomapsL === 'undefined') return;
    protomapsL.leafletLayer({
      url: 'tiles/{z}/{x}/{y}.mvt',
      flavor: 'light',
      lang: 'bg',
      maxDataZoom: state.meta.maxzoom || 14
    }).addTo(map);
  }

  function primaryColor(rec) {
    return MODE_COLOR[rec.modes[0]] || '#374151';
  }

  function drawMarkers() {
    rptLayer.clearLayers();
    state.markers = {};
    visible().forEach(function (rec) {
      var m = L.circleMarker([rec.lat, rec.lng], {
        radius: 8, weight: 2, color: '#fff', fillColor: primaryColor(rec), fillOpacity: 0.95
      });
      m.bindTooltip(rec.call, { permanent: true, direction: 'right', offset: [8, 0], className: 'rpt-label' });
      m.on('click', function () { showDetail(rec); });
      m.addTo(rptLayer);
      state.markers[rec.call] = m;
    });
    updateLabels();
  }
  function updateLabels() {
    var show = map.getZoom() >= 9;
    Object.keys(state.markers).forEach(function (k) {
      var tt = state.markers[k].getTooltip();
      if (tt) tt.setOpacity(show ? 1 : 0);
    });
  }
  map.on('zoomend', updateLabels);

  // ---------- list ----------
  function visible() {
    var q = state.query.trim().toLowerCase();
    return state.repeaters.filter(function (r) {
      if (state.filter !== 'all' && r.modes.indexOf(state.filter) < 0) return false;
      if (q && r.search.indexOf(q) < 0) return false;
      return true;
    });
  }

  function badgesHtml(rec) {
    return '<span class="badges">' + rec.modes.map(function (m) {
      var def = MODES.filter(function (x) { return x.id === m; })[0];
      return '<span class="badge" style="background:' + def.color + '">' + esc(def.label) + '</span>';
    }).join('') + '</span>';
  }

  function renderChips() {
    var box = $('chips');
    box.innerHTML = MODES.map(function (m) {
      var n = m.id === 'all' ? state.repeaters.length
        : state.repeaters.filter(function (r) { return r.modes.indexOf(m.id) >= 0; }).length;
      return '<button class="chip' + (state.filter === m.id ? ' active' : '') + '" data-mode="' + m.id + '">' +
        (m.color ? '<span class="dot" style="background:' + m.color + '"></span>' : '') +
        esc(m.label) + ' ' + n + '</button>';
    }).join('');
  }

  function renderList() {
    renderChips();
    var items = visible();
    if (state.me) {
      items.forEach(function (r) { r.dist = haversineKm(state.me, r); });
      items.sort(function (a, b) { return a.dist - b.dist; });
    }
    $('list-meta').textContent = items.length + ' репитера' + (state.me ? ' · подредени по разстояние от вас' : '');
    $('list').innerHTML = items.map(function (r) {
      var dist = '';
      if (state.me) {
        var b = bearing(state.me, r);
        dist = '<div class="dist">' + r.dist.toFixed(r.dist < 10 ? 1 : 0) + ' км ' + b.dir + '</div>';
      }
      return '<li data-call="' + esc(r.call) + '">' +
        '<div class="main"><div><span class="call">' + esc(r.call) + '</span>' + badgesHtml(r) + '</div>' +
        '<div class="place">' + esc(r.place) + (r.location ? ' · ' + esc(r.location) : '') + '</div></div>' +
        '<div class="right"><div class="freq">' + (r.out ? esc(r.out) : '—') + '</div>' + dist + '</div>' +
        '</li>';
    }).join('');
    $('data-info').textContent = 'Данни: ' + fmtDate(state.dataDate) + ' (' + state.dataSource + ')';
    drawMarkers();
  }

  // ---------- detail ----------
  function row(k, v) { return v == null || v === '' ? '' : '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'; }

  function showDetail(rec) {
    var r = rec.raw, m = r.modes || {};
    $('d-call').innerHTML = esc(rec.call) + badgesHtml(rec);
    var h = '<p class="loc">' + esc(rec.place) + (rec.location ? ' · ' + esc(rec.location) : '') + '</p>';

    h += '<dl class="kv">';
    h += row('Слушате на', rec.out ? '<span class="big">' + esc(rec.out) + '</span> MHz' : null);
    h += row('Предавате на', rec.inp ? esc(rec.inp) + ' MHz' : null);
    if (rec.shift != null && rec.shift !== 0) h += row('Отместване', (rec.shift > 0 ? '+' : '') + rec.shift.toFixed(3) + ' MHz');
    h += row('Тон (CTCSS)', rec.tone ? esc(rec.tone) + ' Hz' : (m.fm && m.fm.enabled ? 'няма' : null));
    h += row('Канал', esc(rec.channel));
    if (state.me) {
      var km = haversineKm(state.me, rec), b = bearing(state.me, rec);
      h += row('Разстояние', km.toFixed(1) + ' км · ' + b.deg + '° ' + b.dir);
    }
    h += row('Надм. височина', r.altitude ? esc(r.altitude) + ' м' : null);
    h += row('Мощност', r.power ? esc(r.power) + ' W' : null);
    h += row('QTH локатор', esc(r.qth));
    h += row('Отговорник', esc(r.keeper));
    h += row('Координати', rec.lat.toFixed(4) + ', ' + rec.lng.toFixed(4));
    if (r.internet && r.internet.echolink) h += row('EchoLink', esc(r.internet.echolink));
    h += '</dl>';

    if (m.dmr && m.dmr.enabled) {
      h += '<h3>DMR</h3><dl class="kv">' +
        row('Color code', esc(m.dmr.color_code)) +
        row('TS1 групи', esc(m.dmr.ts1_groups)) +
        row('TS2 групи', esc(m.dmr.ts2_groups)) +
        row('Мрежа', esc(m.dmr.network)) +
        row('Рефлектор', esc(m.dmr.reflector)) +
        row('Call ID', esc(m.dmr.callid)) + '</dl>';
    }
    if (m.dstar && m.dstar.enabled) {
      h += '<h3>D-Star</h3><dl class="kv">' + row('Рефлектор', esc(m.dstar.reflector)) + row('Модул', esc(m.dstar.module)) + '</dl>';
    }
    if (m.fusion && m.fusion.enabled) {
      h += '<h3>Fusion</h3><dl class="kv">' + row('Рефлектор', esc(m.fusion.reflector)) + '</dl>';
    }
    var notes = [].concat(r.info || [], (m.dmr && m.dmr.info) || [], (m.dstar && m.dstar.info) || [])
      .map(stripHtml).filter(Boolean);
    if (notes.length) h += '<h3>Информация</h3><div class="note">' + esc(notes.join('\n\n')) + '</div>';

    h += '<div class="actions">';
    h += '<button class="btn" id="d-zoom">Покажи на картата</button>';
    if (state.coverage[rec.call]) {
      h += '<button class="btn' + (state.coverageCall === rec.call ? ' on' : '') + '" id="d-cov">Покритие</button>';
    }
    h += '</div>';

    $('d-body').innerHTML = h;
    $('d-zoom').onclick = function () { closeSheet('sheet'); map.setView([rec.lat, rec.lng], Math.max(map.getZoom(), 11)); };
    var cov = $('d-cov');
    if (cov) cov.onclick = function () { toggleCoverage(rec.call); cov.classList.toggle('on', state.coverageCall === rec.call); };

    closeSheet('sheet');
    openSheet('detail');
  }

  function toggleCoverage(call) {
    if (state.coverageLayer) { map.removeLayer(state.coverageLayer); state.coverageLayer = null; }
    if (state.coverageCall === call) { state.coverageCall = null; return; }
    var c = state.coverage[call];
    if (!c) return;
    var b = c.bounds; // [path, lat1, lng1, lat2, lng2]
    state.coverageLayer = L.imageOverlay('coverage/' + call + '.png', [[b[1], b[2]], [b[3], b[4]]], { opacity: 0.5 }).addTo(map);
    state.coverageCall = call;
  }

  // ---------- sheets ----------
  function openSheet(id) { $(id).classList.remove('hidden'); }
  function closeSheet(id) { $(id).classList.add('hidden'); }

  $('btn-list').onclick = function () { closeSheet('detail'); openSheet('sheet'); };
  $('btn-close-sheet').onclick = function () { closeSheet('sheet'); };
  $('btn-close-detail').onclick = function () { closeSheet('detail'); };
  $('search').addEventListener('input', function (e) { state.query = e.target.value; renderList(); });
  $('chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    state.filter = b.getAttribute('data-mode');
    renderList();
  });
  $('list').addEventListener('click', function (e) {
    var li = e.target.closest('li');
    if (!li) return;
    var call = li.getAttribute('data-call');
    var rec = state.repeaters.filter(function (r) { return r.call === call; })[0];
    if (rec) { map.setView([rec.lat, rec.lng], Math.max(map.getZoom(), 10)); showDetail(rec); }
  });
  map.on('click', function () { closeSheet('detail'); });

  // ---------- location ----------
  var watchId = null, firstFix = true;
  function onPos(p) {
    state.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    meLayer.clearLayers();
    L.circle([state.me.lat, state.me.lng], { radius: state.me.acc, weight: 1, color: '#2563eb', fillOpacity: 0.1 }).addTo(meLayer);
    L.circleMarker([state.me.lat, state.me.lng], { radius: 7, weight: 3, color: '#fff', fillColor: '#2563eb', fillOpacity: 1 }).addTo(meLayer);
    if (firstFix) { firstFix = false; map.setView([state.me.lat, state.me.lng], 10); }
    renderList();
  }
  function onPosErr(err) {
    if (firstFix) alertMsg('Няма достъп до местоположението (' + (err && err.message ? err.message : 'грешка') + ').');
  }
  function alertMsg(t) { $('list-meta').textContent = t; openSheet('sheet'); }
  $('btn-locate').onclick = function () {
    if (!navigator.geolocation) return alertMsg('Устройството не поддържа GPS.');
    if (state.me) { map.setView([state.me.lat, state.me.lng], Math.max(map.getZoom(), 11)); }
    if (watchId == null) {
      firstFix = !state.me;
      watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    }
  };

  // ---------- online indicator ----------
  function updateNet() {
    var el = $('net');
    el.className = 'net ' + (navigator.onLine ? 'on' : 'off');
    el.title = navigator.onLine ? 'Онлайн' : 'Офлайн';
  }
  window.addEventListener('online', function () { updateNet(); refreshOnline(); });
  window.addEventListener('offline', updateNet);
  updateNet();

  // ---------- boot ----------
  loadJSON('data/meta.json').catch(function () { return {}; }).then(function (meta) {
    state.meta = Object.assign(state.meta, meta || {});
    addBaseLayer();
    return loadJSON('data/coverage.json').catch(function () { return {}; });
  }).then(function (cov) {
    state.coverage = cov || {};
    return loadBundled();
  }).then(function () {
    refreshOnline();
  });
})();

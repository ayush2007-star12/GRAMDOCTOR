// GramDoc app. No server: data stays in this phone's browser (localStorage).
(function () {
  'use strict';
  var KEY_VISITS = 'gramdoc.visits', KEY_LANG = 'gramdoc.lang';
  var SYMS = Triage.SYMPTOMS;
  var lang = 'en';
  var view = 'check';
  var detailId = null;      // visit shown in the detail view
  var doctorCase = null;    // visit opened by the doctor
  var doctorRx = null;      // prescription made by the doctor in this session

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function t(key, v) {
    var s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    return v === undefined ? s : s.replace('{v}', v);
  }
  function h(tag, props) {
    var el = document.createElement(tag), i, k;
    props = props || {};
    for (k in props) {
      var val = props[k];
      if (val === false || val == null) continue;
      if (k === 'class') el.className = val;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), val);
      else el.setAttribute(k, val);
    }
    for (i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function randomText(n) {
    var chars = 'abcdefghijkmnpqrstuvwxyz23456789', out = '', a = new Uint8Array(n), i;
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (i = 0; i < n; i++) out += chars[a[i] % chars.length];
    return out;
  }
  function clamp(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, n); }
  function numOrNull(x, lo, hi) {
    if (x === '' || x == null) return null;
    var n = Number(x);
    return (isFinite(n) && n >= lo && n <= hi) ? n : null;
  }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function isoDate(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(n) { var d = today(); d.setDate(d.getDate() + n); return isoDate(d); }
  function daysFromToday(iso) {
    var p = String(iso).split('-'); if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return Math.round((d - today()) / 86400000);
  }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; } }

  // links carry data in the part after '#', which is never sent to any server
  function enc(o) {
    var bytes = new TextEncoder().encode(JSON.stringify(o)), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function dec(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(b));
  }
  function baseUrl() { return location.origin + location.pathname; }

  // ---------- data ----------
  function loadVisits() {
    try { var a = JSON.parse(store(KEY_VISITS) || '[]'); return Array.isArray(a) ? a.map(cleanVisit).filter(Boolean) : []; } catch (e) { return []; }
  }
  var visits = [];
  function saveVisits() { store(KEY_VISITS, JSON.stringify(visits)); }
  function findVisit(id) { for (var i = 0; i < visits.length; i++) if (visits[i].id === id) return visits[i]; return null; }

  // make any object (from storage or from a link) safe and well-formed
  function cleanVisit(o) {
    if (!o || typeof o !== 'object') return null;
    var p = o.patient || {}, v = o.vitals || {};
    var id = clamp(o.id, 40); if (!/^[A-Za-z0-9-]{4,40}$/.test(id)) return null;
    var room = clamp(o.room, 60); if (!/^[A-Za-z0-9-]{8,60}$/.test(room)) room = 'GramDoc-' + randomText(12);
    var created = clamp(o.createdAt, 40); if (isNaN(Date.parse(created))) created = new Date().toISOString();
    var vit = {
      sbp: numOrNull(v.sbp, 50, 300), dbp: numOrNull(v.dbp, 30, 200), sugar: numOrNull(v.sugar, 20, 800),
      sugarType: v.sugarType === 'fasting' ? 'fasting' : 'random',
      temp: numOrNull(v.temp, 30, 45), spo2: numOrNull(v.spo2, 50, 100), pulse: numOrNull(v.pulse, 20, 250)
    };
    var visit = {
      id: id, createdAt: created, room: room,
      patient: {
        name: clamp(p.name, 80), age: numOrNull(p.age, 0, 120), gender: ['F', 'M', 'O'].indexOf(p.gender) >= 0 ? p.gender : 'O',
        village: clamp(p.village, 80), phone: clamp(p.phone, 15)
      },
      symptoms: (Array.isArray(o.symptoms) ? o.symptoms : []).filter(function (s) { return SYMS.indexOf(s) >= 0; }),
      vitals: vit, rx: cleanRx(o.rx), followUp: /^\d{4}-\d{2}-\d{2}$/.test(o.followUp || '') ? o.followUp : null
    };
    if (!visit.patient.name) return null;
    // always work out the risk level here again, never trust a link
    visit.triage = Triage.assess({ age: visit.patient.age, symptoms: visit.symptoms, vitals: vit });
    if (!visit.followUp) visit.followUp = addDays(Triage.defaultFollowDays(visit.triage.level));
    return visit;
  }
  function cleanRx(r) {
    if (!r || typeof r !== 'object') return null;
    var rx = {
      doctor: clamp(r.doctor, 80), diagnosis: clamp(r.diagnosis, 300), medicines: clamp(r.medicines, 1500),
      advice: clamp(r.advice, 800), followDays: Math.round(numOrNull(r.followDays, 0, 365) || 0), date: clamp(r.date, 40)
    };
    return (rx.doctor && (rx.diagnosis || rx.medicines)) ? rx : null;
  }

  // ---------- language ----------
  function applyI18n(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
  }
  function setLang(l) {
    lang = l; store(KEY_LANG, l);
    document.documentElement.lang = l;
    $('langBtn').textContent = l === 'hi' ? 'English' : 'हिंदी';
    applyI18n(); updateNet(); renderCurrent();
  }
  function updateNet() {
    var on = navigator.onLine !== false, el = $('net');
    el.textContent = on ? t('online') : t('offline');
    el.className = 'net' + (on ? '' : ' off');
  }

  // ---------- views ----------
  function show(name) {
    view = name;
    ['check', 'records', 'doctor', 'detail'].forEach(function (n) { $('view-' + n).hidden = (n !== name); });
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === name || (name === 'detail' && b.getAttribute('data-view') === 'records')); });
    window.scrollTo(0, 0);
    renderCurrent();
  }
  function renderCurrent() {
    if (view === 'records') renderRecords();
    else if (view === 'detail') renderDetail();
    else if (view === 'doctor') renderDoctor();
  }

  // ---------- pieces shared by several screens ----------
  function reasonText(r) { return t('r_' + r.code, r.v); }
  function banner(visit) {
    var lv = visit.triage.level;
    return h('div', { class: 'banner lv-' + lv },
      h('h2', {}, t('lvl_' + lv)),
      h('div', {}, t('adv_' + lv)),
      visit.triage.reasons.length ? h('ul', {}, visit.triage.reasons.map(function (r) { return h('li', {}, reasonText(r)); })) : null);
  }
  function summary(visit) {
    var p = visit.patient, v = visit.vitals;
    function val(x, unit) { return x === null ? t('not_taken') : x + ' ' + unit; }
    var rows = [
      [t('s_age'), p.age === null ? '-' : p.age],
      [t('s_gender'), t(p.gender === 'F' ? 'g_f' : p.gender === 'M' ? 'g_m' : 'g_o')],
      [t('s_village'), p.village || '-'], [t('s_phone'), p.phone || '-'], [t('s_date'), fmtDate(visit.createdAt)],
      [t('s_symptoms'), visit.symptoms.length ? visit.symptoms.map(function (s) { return t('sym_' + s); }).join(', ') : t('none')],
      [t('s_bp'), v.sbp !== null && v.dbp !== null ? v.sbp + '/' + v.dbp + ' mmHg' : t('not_taken')],
      [t('s_sugar'), v.sugar === null ? t('not_taken') : v.sugar + ' mg/dL (' + t(v.sugarType === 'fasting' ? 'st_fasting' : 'st_random').split(' (')[0] + ')'],
      [t('s_temp'), val(v.temp, '°C')], [t('s_spo2'), val(v.spo2, '%')], [t('s_pulse'), val(v.pulse, '/min')]
    ];
    var kv = h('div', { class: 'kv' });
    rows.forEach(function (r) { kv.appendChild(h('b', {}, r[0])); kv.appendChild(h('span', {}, String(r[1]))); });
    return h('div', { class: 'card' }, h('h2', {}, p.name), kv);
  }
  function slip(name, rx) {
    var lines = [];
    lines.push(t('s_doctor') + ': ' + rx.doctor);
    if (rx.diagnosis) lines.push(t('s_diag') + ': ' + rx.diagnosis);
    if (rx.medicines) lines.push('\n' + t('s_meds') + ':\n' + rx.medicines);
    if (rx.advice) lines.push('\n' + t('s_advice') + ': ' + rx.advice);
    if (rx.followDays) lines.push('\n' + t('followup') + ': ' + t('in_days', rx.followDays));
    return h('div', { class: 'card' }, h('h2', {}, t('rx_title') + ' - ' + name), h('div', { class: 'slip' }, lines.join('\n')));
  }
  function followLabel(visit) {
    var d = daysFromToday(visit.followUp);
    if (d === null) return { text: '-', over: false };
    if (d < 0) return { text: t('overdue', -d), over: true };
    if (d === 0) return { text: t('due_today'), over: true };
    return { text: t('in_days', d), over: false };
  }
  function copyText(text, msgEl) {
    function done() { if (msgEl) { msgEl.textContent = t('copied'); } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy', text); });
    else window.prompt('Copy', text);
  }
  function waLink(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }
  function caseLink(visit) {
    return baseUrl() + '#case=' + enc({ v: 1, id: visit.id, createdAt: visit.createdAt, room: visit.room, patient: visit.patient, symptoms: visit.symptoms, vitals: visit.vitals });
  }
  function videoUrl(visit) { return 'https://meet.jit.si/' + visit.room; }

  // ---------- 1. new check ----------
  function buildSymptoms() {
    var box = $('symptomBox');
    SYMS.forEach(function (s) {
      box.appendChild(h('label', { class: 'chip' }, h('input', { type: 'checkbox', name: 'sym', value: s }), h('span', { 'data-i18n': 'sym_' + s })));
    });
  }
  function onCheck(e) {
    e.preventDefault();
    var f = e.target, err = $('formError'), fd = new FormData(f);
    function fail(k) { err.textContent = t(k); err.hidden = false; }
    err.hidden = true;
    var name = clamp(fd.get('name'), 80).trim(), age = numOrNull(fd.get('age'), 0, 120);
    if (!name || age === null) return fail('err_name');
    var raw = {};
    ['sbp', 'dbp', 'sugar', 'temp', 'spo2', 'pulse'].forEach(function (k) {
      var s = String(fd.get(k) || '').trim();
      raw[k] = s;
      var lim = { sbp: [50, 300], dbp: [30, 200], sugar: [20, 800], temp: [30, 45], spo2: [50, 100], pulse: [20, 250] }[k];
      if (s !== '' && numOrNull(s, lim[0], lim[1]) === null) raw.bad = true;
    });
    if (raw.bad) return fail('err_range');
    if ((raw.sbp === '') !== (raw.dbp === '')) return fail('err_bp');
    var syms = fd.getAll('sym');
    var anyReading = ['sbp', 'sugar', 'temp', 'spo2', 'pulse'].some(function (k) { return raw[k] !== ''; });
    if (!syms.length && !anyReading) return fail('err_data');

    var visit = cleanVisit({
      id: 'v' + Date.now().toString(36) + randomText(4), createdAt: new Date().toISOString(), room: 'GramDoc-' + randomText(12),
      patient: { name: name, age: age, gender: fd.get('gender'), village: fd.get('village'), phone: fd.get('phone') },
      symptoms: syms,
      vitals: { sbp: raw.sbp, dbp: raw.dbp, sugar: raw.sugar, sugarType: fd.get('sugarType'), temp: raw.temp, spo2: raw.spo2, pulse: raw.pulse }
    });
    visits.unshift(visit); saveVisits();
    f.reset();
    detailId = visit.id; show('detail');
  }
  function fillExample() {
    var f = $('checkForm');
    f.name.value = 'Ramesh Kumar'; f.age.value = 58; f.gender.value = 'M'; f.village.value = 'Rampur'; f.phone.value = '';
    f.sbp.value = 168; f.dbp.value = 102; f.sugar.value = 240; f.sugarType.value = 'random'; f.temp.value = 37.2; f.spo2.value = 96; f.pulse.value = 88;
    f.querySelectorAll('input[name=sym]').forEach(function (c) { c.checked = (c.value === 'headache' || c.value === 'thirst'); });
  }

  // ---------- detail (health worker) ----------
  function renderDetail() {
    var box = $('detail'), visit = findVisit(detailId);
    box.textContent = '';
    if (!visit) { show('records'); return; }
    var lv = visit.triage.level, copyMsg = h('span', { class: 'note' });
    var actions = h('div', { class: 'actions no-print' });
    if (lv === 'emergency') actions.appendChild(h('a', { class: 'btn red', href: 'tel:108' }, t('call108')));
    actions.appendChild(h('a', { class: 'btn', href: videoUrl(visit), target: '_blank', rel: 'noopener' }, t('btn_video')));
    var msg = visit.patient.name + ' (' + (visit.patient.age === null ? '' : visit.patient.age) + ') - ' + t('lvl_' + lv) + '\n';
    actions.appendChild(h('a', { class: 'btn blue', href: waLink(msg + videoUrl(visit) + '\n' + caseLink(visit)), target: '_blank', rel: 'noopener' }, t('btn_wa')));
    actions.appendChild(h('button', { class: 'btn grey', type: 'button', onclick: function () { copyText(caseLink(visit), copyMsg); } }, t('btn_copy')));
    actions.appendChild(h('button', { class: 'btn grey', type: 'button', onclick: function () { window.print(); } }, t('btn_print')));

    var fl = followLabel(visit);
    box.appendChild(h('button', { class: 'small-btn no-print', type: 'button', onclick: function () { show('records'); } }, '< ' + t('btn_back')));
    box.appendChild(h('div', { style: 'height:10px' }));
    box.appendChild(banner(visit));
    box.appendChild(actions); box.appendChild(copyMsg);
    box.appendChild(summary(visit));
    box.appendChild(visit.rx ? slip(visit.patient.name, visit.rx) : h('div', { class: 'card note' }, t('rx_none')));
    box.appendChild(h('p', {}, h('b', {}, t('followup') + ': '), fmtDate(visit.followUp), ' (', h('span', { class: 'due' + (fl.over ? ' over' : '') }, fl.text), ')'));
    box.appendChild(h('button', { class: 'small-btn no-print', type: 'button', onclick: function () {
      if (confirm(t('confirm_delete'))) { visits = visits.filter(function (x) { return x.id !== visit.id; }); saveVisits(); show('records'); }
    } }, t('btn_delete')));
  }

  // ---------- 2. records ----------
  function renderRecords() {
    var list = $('recList'); list.textContent = '';
    if (!visits.length) { list.appendChild(h('p', { class: 'empty' }, t('rec_empty'))); return; }
    visits.forEach(function (vis) {
      var fl = followLabel(vis);
      list.appendChild(h('button', { class: 'rec', type: 'button', onclick: function () { detailId = vis.id; show('detail'); } },
        h('span', {}, h('b', {}, vis.patient.name), h('small', {}, [vis.patient.age === null ? '' : vis.patient.age, vis.patient.village, fmtDate(vis.createdAt)].filter(Boolean).join(' · ')),
          h('small', {}, t('followup') + ': ', h('span', { class: 'due' + (fl.over ? ' over' : '') }, fl.text))),
        h('span', { class: 'badge lv-' + vis.triage.level }, t('lvl_' + vis.triage.level))));
    });
  }
  function csvCell(x) {
    var s = String(x == null ? '' : x);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // stop spreadsheet formulas
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function downloadCsv() {
    var rows = [['date', 'name', 'age', 'gender', 'village', 'phone', 'level', 'bp', 'sugar', 'temp_c', 'spo2', 'pulse', 'symptoms', 'diagnosis', 'follow_up']];
    visits.forEach(function (x) {
      var v = x.vitals;
      rows.push([x.createdAt.slice(0, 10), x.patient.name, x.patient.age, x.patient.gender, x.patient.village, x.patient.phone, x.triage.level,
        v.sbp !== null ? v.sbp + '/' + v.dbp : '', v.sugar, v.temp, v.spo2, v.pulse, x.symptoms.join(' '), x.rx ? x.rx.diagnosis : '', x.followUp]);
    });
    var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'gramdoc-patients.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- 3. doctor ----------
  function openFromText(text) {
    var m = String(text).trim().match(/#?(case|rx)=([A-Za-z0-9_-]+)\s*$/);
    if (!m) return false;
    try {
      var data = dec(m[2]);
      if (m[1] === 'case') {
        var visit = cleanVisit(data);
        if (!visit) return false;
        doctorCase = visit; doctorRx = null; show('doctor'); return true;
      }
      var rx = cleanRx(data.rx), id = clamp(data.id, 40);
      if (!rx) return false;
      var mine = findVisit(id);
      if (mine) {
        mine.rx = rx; mine.followUp = rx.followDays ? addDays(rx.followDays) : mine.followUp; saveVisits();
        detailId = mine.id; show('detail');
      } else {
        show('detail'); var box = $('detail'); box.textContent = '';
        box.appendChild(h('p', { class: 'note' }, t('rx_notfound')));
        box.appendChild(slip(clamp(data.n, 80), rx));
      }
      return true;
    } catch (e) { return false; }
  }
  function renderDoctor() {
    var open = $('docOpen'), box = $('docCase');
    box.textContent = '';
    open.hidden = !!doctorCase;
    box.hidden = !doctorCase;
    if (!doctorCase) return;
    var visit = doctorCase;
    box.appendChild(h('button', { class: 'small-btn', type: 'button', onclick: function () { doctorCase = null; doctorRx = null; renderDoctor(); } }, '< ' + t('btn_open_case')));
    box.appendChild(h('div', { style: 'height:10px' }));
    box.appendChild(banner(visit));
    box.appendChild(h('div', { class: 'actions' }, h('a', { class: 'btn', href: videoUrl(visit), target: '_blank', rel: 'noopener' }, t('doc_video'))));
    box.appendChild(summary(visit));

    var form = h('form', { class: 'card', novalidate: 'novalidate', onsubmit: onRx },
      h('h2', {}, t('rx_form')),
      h('label', {}, h('span', {}, t('rx_doctor')), h('input', { name: 'doctor', maxlength: '80', value: doctorRx ? doctorRx.doctor : '' })),
      h('label', {}, h('span', {}, t('rx_diag')), h('input', { name: 'diagnosis', maxlength: '300', value: doctorRx ? doctorRx.diagnosis : '' })),
      h('label', {}, h('span', {}, t('rx_meds')), h('textarea', { name: 'medicines', maxlength: '1500' }, doctorRx ? doctorRx.medicines : '')),
      h('label', {}, h('span', {}, t('rx_advice')), h('textarea', { name: 'advice', maxlength: '800' }, doctorRx ? doctorRx.advice : '')),
      h('label', {}, h('span', {}, t('rx_follow')), h('input', { name: 'followDays', type: 'number', min: '0', max: '365', inputmode: 'numeric', value: doctorRx ? doctorRx.followDays : Triage.defaultFollowDays(visit.triage.level) })),
      h('p', { id: 'rxError', class: 'error', hidden: 'hidden' }),
      h('button', { class: 'btn big', type: 'submit' }, t('btn_rx')));
    box.appendChild(form);
    if (doctorRx) box.appendChild(rxResult(visit, doctorRx));
  }
  function rxLink(visit, rx) { return baseUrl() + '#rx=' + enc({ v: 1, id: visit.id, n: visit.patient.name, rx: rx }); }
  function rxResult(visit, rx) {
    var link = rxLink(visit, rx), msg = h('span', { class: 'note' });
    return h('div', {}, slip(visit.patient.name, rx), h('p', {}, t('rx_ready')),
      h('div', { class: 'actions' },
        h('a', { class: 'btn blue', href: waLink(visit.patient.name + ' - ' + t('rx_title') + '\n' + link), target: '_blank', rel: 'noopener' }, t('btn_wa_rx')),
        h('button', { class: 'btn grey', type: 'button', onclick: function () { copyText(link, msg); } }, t('btn_copy_rx')),
        h('button', { class: 'btn grey', type: 'button', onclick: function () { window.print(); } }, t('btn_print'))), msg);
  }
  function onRx(e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var rx = cleanRx({ doctor: fd.get('doctor'), diagnosis: fd.get('diagnosis'), medicines: fd.get('medicines'), advice: fd.get('advice'), followDays: fd.get('followDays'), date: new Date().toISOString() });
    if (!rx) { var er = $('rxError'); er.textContent = t('err_rx'); er.hidden = false; return; }
    doctorRx = rx;
    var mine = findVisit(doctorCase.id);       // same phone used by health worker and doctor
    if (mine) { mine.rx = rx; mine.followUp = rx.followDays ? addDays(rx.followDays) : mine.followUp; saveVisits(); }
    renderDoctor();
    var r = $('docCase').lastChild; if (r && r.scrollIntoView) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- start ----------
  function fromHash() {
    if (!location.hash) return;
    var ok = openFromText(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (!ok) { show('doctor'); var er = $('pasteError'); er.textContent = t('err_link'); er.hidden = false; }
  }
  function init() {
    visits = loadVisits();
    buildSymptoms();
    document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-view')); }); });
    $('checkForm').addEventListener('submit', onCheck);
    $('exampleBtn').addEventListener('click', fillExample);
    $('csvBtn').addEventListener('click', downloadCsv);
    $('langBtn').addEventListener('click', function () { setLang(lang === 'hi' ? 'en' : 'hi'); });
    $('openCaseBtn').addEventListener('click', function () {
      var er = $('pasteError'); er.hidden = true;
      if (!openFromText($('pasteLink').value)) { er.textContent = t('err_link'); er.hidden = false; }
    });
    window.addEventListener('online', updateNet); window.addEventListener('offline', updateNet);
    window.addEventListener('hashchange', fromHash);
    var saved = store(KEY_LANG);
    setLang(saved === 'hi' || saved === 'en' ? saved : ((navigator.language || '').indexOf('hi') === 0 ? 'hi' : 'en'));
    fromHash();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  document.addEventListener('DOMContentLoaded', init);
})();

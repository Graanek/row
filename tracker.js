// =============================================================
// tracker.js — Life Tracker shared module (pattern engine).
// Vanilla JS, no deps. Storage: localStorage, prefix "life:".
// Schema is versioned (life:meta.version) with migration paths.
// Public API: window.LifeTracker
// =============================================================
(function () {
  'use strict';

  var PREFIX = 'life:';
  var SCHEMA_VERSION = 1;
  var MIN_DAYS_FOR_PATTERNS = 14;
  var MIN_BUCKET_N = 4;

  // ---------- storage primitives ----------
  function sGet(key) {
    try { return JSON.parse(localStorage.getItem(PREFIX + key)); } catch (e) { return null; }
  }
  function sSet(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) {}
  }
  function sRemove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  }
  function listKeys(prefix) {
    var out = [];
    var full = PREFIX + (prefix || '');
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(full) === 0) out.push(k.slice(PREFIX.length));
    }
    return out;
  }

  // ---------- schema / migrations ----------
  // Each migration upgrades from version N to N+1. To evolve the schema,
  // bump SCHEMA_VERSION and append MIGRATIONS[N] = function () { ... }.
  var MIGRATIONS = {
    0: function () { /* v0 -> v1: initial schema, nothing to transform */ }
  };
  function migrate() {
    var meta = sGet('meta') || { version: 0 };
    var v = meta.version || 0;
    while (v < SCHEMA_VERSION) {
      if (typeof MIGRATIONS[v] === 'function') { try { MIGRATIONS[v](); } catch (e) {} }
      v++;
    }
    if ((meta.version || 0) !== SCHEMA_VERSION) sSet('meta', { version: SCHEMA_VERSION });
  }

  // ---------- date helpers ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function keyToDate(k) {
    var p = k.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(k, n) {
    var d = keyToDate(k); d.setDate(d.getDate() + n); return dateKey(d);
  }
  function nowHM() {
    var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function hmToMin(hm) {
    if (!hm || hm.indexOf(':') < 0) return null;
    var p = hm.split(':'); return (+p[0]) * 60 + (+p[1]);
  }
  function minToHM(m) {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  // ---------- day entries ----------
  function emptyDay() {
    return { sleep: null, meals: [], moods: [], moves: [], supps: [], prod: null, weight: null };
  }
  function getDay(k) {
    var e = sGet('d:' + k);
    if (!e || typeof e !== 'object') return emptyDay();
    var base = emptyDay();
    for (var key in base) if (e[key] !== undefined) base[key] = e[key];
    return base;
  }
  function isEmptyDay(e) {
    return !e.sleep && !e.meals.length && !e.moods.length && !e.moves.length &&
           !e.supps.length && !e.prod && e.weight == null;
  }
  function saveDay(k, entry) {
    pushUndo(k);
    if (isEmptyDay(entry)) sRemove('d:' + k);
    else sSet('d:' + k, entry);
    notify();
  }
  function listDayKeys() {
    return listKeys('d:').map(function (k) { return k.slice(2); }).sort();
  }

  // ---------- undo (in-memory, last 10 actions) ----------
  var undoStack = [];
  function pushUndo(k) {
    undoStack.push({ key: k, prev: sGet('d:' + k) });
    if (undoStack.length > 10) undoStack.shift();
  }
  function undo() {
    var u = undoStack.pop();
    if (!u) return false;
    if (u.prev == null) sRemove('d:' + u.key);
    else sSet('d:' + u.key, u.prev);
    notify();
    return true;
  }
  function canUndo() { return undoStack.length > 0; }

  // ---------- change notifications ----------
  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function notify() {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} }
  }

  // ---------- convenience loggers (each = one undoable action) ----------
  function logSleep(k, sleep) { var e = getDay(k); e.sleep = sleep; saveDay(k, e); }
  function logMeal(k, meal)   { var e = getDay(k); e.meals.push(meal); saveDay(k, e); }
  function logMood(k, mood)   { var e = getDay(k); e.moods.push(mood); saveDay(k, e); }
  function logMove(k, move)   { var e = getDay(k); e.moves.push(move); saveDay(k, e); }
  function logSupp(k, supp)   { var e = getDay(k); e.supps.push(supp); saveDay(k, e); }
  function logProd(k, prod)   { var e = getDay(k); e.prod = prod; saveDay(k, e); }
  function logWeight(k, w)    { var e = getDay(k); e.weight = w; saveDay(k, e); }

  // ---------- history-based defaults (autocomplete + typical times) ----------
  function recentDays(n) {
    var keys = listDayKeys();
    return keys.slice(Math.max(0, keys.length - n));
  }
  function mealHistory() {
    // Returns [{name, count, lastTime, avgMin}] sorted by frequency.
    var map = {};
    recentDays(45).forEach(function (k) {
      getDay(k).meals.forEach(function (m) {
        if (!m.name) return;
        var key = m.name.toLowerCase();
        if (!map[key]) map[key] = { name: m.name, count: 0, times: [] };
        map[key].count++;
        var min = hmToMin(m.t);
        if (min != null) map[key].times.push(min);
      });
    });
    return Object.keys(map).map(function (k) {
      var x = map[k];
      var avg = x.times.length ? x.times.reduce(function (a, b) { return a + b; }, 0) / x.times.length : null;
      return { name: x.name, count: x.count, typicalTime: avg != null ? minToHM(avg) : null };
    }).sort(function (a, b) { return b.count - a.count; });
  }
  function suppHistory() {
    var map = {};
    recentDays(45).forEach(function (k) {
      getDay(k).supps.forEach(function (s) {
        if (!s.name) return;
        var key = s.name.toLowerCase();
        map[key] = map[key] || { name: s.name, count: 0 };
        map[key].count++;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count; });
  }
  function moveHistory() {
    var map = {};
    recentDays(45).forEach(function (k) {
      getDay(k).moves.forEach(function (m) {
        if (!m.type) return;
        var key = m.type.toLowerCase();
        map[key] = map[key] || { type: m.type, kind: m.kind, count: 0, mins: [] };
        map[key].count++;
        if (m.min) map[key].mins.push(m.min);
      });
    });
    return Object.keys(map).map(function (k) {
      var x = map[k];
      var avg = x.mins.length ? Math.round(x.mins.reduce(function (a, b) { return a + b; }, 0) / x.mins.length) : null;
      return { type: x.type, kind: x.kind, count: x.count, typicalMin: avg };
    }).sort(function (a, b) { return b.count - a.count; });
  }
  function typicalSleep() {
    // Median bed/wake times + duration from last 30 logged sleeps.
    var beds = [], wakes = [], hrs = [];
    recentDays(30).forEach(function (k) {
      var s = getDay(k).sleep;
      if (!s) return;
      if (s.start) {
        var b = hmToMin(s.start);
        if (b != null) beds.push(b < 720 ? b + 1440 : b); // map post-midnight to >24h for median
      }
      if (s.end) { var w = hmToMin(s.end); if (w != null) wakes.push(w); }
      if (s.hours) hrs.push(s.hours);
    });
    function median(a) {
      if (!a.length) return null;
      a = a.slice().sort(function (x, y) { return x - y; });
      return a[Math.floor(a.length / 2)];
    }
    var mb = median(beds), mw = median(wakes), mh = median(hrs);
    return {
      bed: mb != null ? minToHM(mb) : '23:00',
      wake: mw != null ? minToHM(mw) : '07:00',
      hours: mh != null ? Math.round(mh * 2) / 2 : 7.5
    };
  }

  // ---------- daily summaries ----------
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function summary(k) {
    var e = getDay(k);
    var moods = e.moods.map(function (m) { return m.mood; }).filter(function (x) { return x != null; });
    var energies = e.moods.map(function (m) { return m.energy; }).filter(function (x) { return x != null; });
    var moveMin = e.moves.reduce(function (s, m) { return s + (m.min || 0); }, 0);
    return {
      key: k,
      sleepH: e.sleep ? e.sleep.hours : null,
      sleepQ: e.sleep ? e.sleep.quality : null,
      bedMin: e.sleep && e.sleep.start ? hmToMin(e.sleep.start) : null,
      mood: avg(moods),
      energy: avg(energies),
      fastfood: e.meals.some(function (m) { return m.fastfood; }),
      alcohol: e.meals.some(function (m) { return m.alcohol; }),
      mealsN: e.meals.length,
      moveMin: moveMin,
      strength: e.moves.some(function (m) { return m.kind === 'strength'; }),
      cardio: e.moves.some(function (m) { return m.kind === 'cardio'; }),
      deepWork: e.prod ? e.prod.deepWork : null,
      pomodoro: e.prod ? e.prod.pomodoro : null,
      weight: e.weight,
      suppsN: e.supps.length,
      tags: e.moods.reduce(function (s, m) { return s.concat(m.tags || []); }, [])
    };
  }
  function allSummaries() { return listDayKeys().map(summary); }

  // ---------- correlation engine ----------
  function round1(x) { return Math.round(x * 10) / 10; }
  function pearson(xs, ys) {
    var n = xs.length;
    if (n < 5) return null;
    var mx = avg(xs), my = avg(ys), num = 0, dx = 0, dy = 0;
    for (var i = 0; i < n; i++) {
      var a = xs[i] - mx, b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    if (!dx || !dy) return null;
    return num / Math.sqrt(dx * dy);
  }
  // Split-mean: mean of `metric` in days where cond is true vs false.
  function splitMean(sums, cond, metric) {
    var a = [], b = [];
    sums.forEach(function (s) {
      var v = s[metric];
      if (v == null) return;
      (cond(s) ? a : b).push(v);
    });
    if (a.length < MIN_BUCKET_N || b.length < MIN_BUCKET_N) return null;
    return { meanA: avg(a), nA: a.length, meanB: avg(b), nB: b.length, delta: avg(a) - avg(b) };
  }
  function findings() {
    var sums = allSummaries();
    if (sums.length < MIN_DAYS_FOR_PATTERNS) {
      return { ready: false, daysLogged: sums.length, needed: MIN_DAYS_FOR_PATTERNS, items: [] };
    }
    var byKey = {};
    sums.forEach(function (s) { byKey[s.key] = s; });
    function nextDay(s) { return byKey[addDays(s.key, 1)] || null; }

    var items = [];

    // 1. Sleep duration -> same-day mood
    var r = splitMean(sums, function (s) { return s.sleepH != null && s.sleepH >= 7.5; }, 'mood');
    var r2 = (function () {
      var a = [], b = [];
      sums.forEach(function (s) {
        if (s.mood == null || s.sleepH == null) return;
        if (s.sleepH >= 7.5) a.push(s.mood);
        else if (s.sleepH < 6.5) b.push(s.mood);
      });
      if (a.length < MIN_BUCKET_N || b.length < MIN_BUCKET_N) return null;
      return { meanA: avg(a), nA: a.length, meanB: avg(b), nB: b.length, delta: avg(a) - avg(b) };
    })();
    if (r2) items.push({
      id: 'sleep_mood',
      label: 'Po ≥7.5h snu: średni nastrój ' + round1(r2.meanA) + ' vs <6.5h: ' + round1(r2.meanB),
      delta: round1(r2.delta), n: r2.nA + r2.nB
    });
    else if (r) items.push({
      id: 'sleep_mood',
      label: 'Po ≥7.5h snu: średni nastrój ' + round1(r.meanA) + ' vs krócej: ' + round1(r.meanB),
      delta: round1(r.delta), n: r.nA + r.nB
    });

    // 2. Sleep duration -> same-day energy
    var se = splitMean(sums, function (s) { return s.sleepH != null && s.sleepH >= 7.5; }, 'energy');
    if (se) items.push({
      id: 'sleep_energy',
      label: 'Po ≥7.5h snu: energia ' + round1(se.meanA) + ' vs krócej: ' + round1(se.meanB),
      delta: round1(se.delta), n: se.nA + se.nB
    });

    // 3. Alcohol -> next-day energy
    (function () {
      var a = [], b = [];
      sums.forEach(function (s) {
        var nx = nextDay(s);
        if (!nx || nx.energy == null) return;
        (s.alcohol ? a : b).push(nx.energy);
      });
      if (a.length >= MIN_BUCKET_N && b.length >= MIN_BUCKET_N) {
        items.push({
          id: 'alcohol_energy',
          label: 'Dzień po alkoholu: energia ' + round1(avg(a)) + ' vs bez: ' + round1(avg(b)),
          delta: round1(avg(a) - avg(b)), n: a.length + b.length
        });
      }
    })();

    // 4. Alcohol -> sleep quality that night
    var aq = splitMean(sums, function (s) { return s.alcohol; }, 'sleepQ');
    if (aq) items.push({
      id: 'alcohol_sleepq',
      label: 'Jakość snu w dni z alkoholem: ' + round1(aq.meanA) + ' vs bez: ' + round1(aq.meanB),
      delta: round1(aq.delta), n: aq.nA + aq.nB
    });

    // 5. Fastfood -> same-day energy
    var fe = splitMean(sums, function (s) { return s.fastfood; }, 'energy');
    if (fe) items.push({
      id: 'fastfood_energy',
      label: 'W dni z fastfoodem: energia ' + round1(fe.meanA) + ' vs bez: ' + round1(fe.meanB),
      delta: round1(fe.delta), n: fe.nA + fe.nB
    });

    // 6. Strength training -> same-day mood
    var st = splitMean(sums, function (s) { return s.strength; }, 'mood');
    if (st) items.push({
      id: 'strength_mood',
      label: 'W dni z siłownią: nastrój ' + round1(st.meanA) + ' vs bez: ' + round1(st.meanB),
      delta: round1(st.delta), n: st.nA + st.nB
    });

    // 7. Late bedtime (after midnight) -> next-day energy
    (function () {
      var a = [], b = [];
      sums.forEach(function (s) {
        var nx = nextDay(s);
        if (!nx || nx.energy == null || s.bedMin == null) return;
        var late = s.bedMin < 720; // 00:00-11:59 logged as bedtime = after midnight
        (late ? a : b).push(nx.energy);
      });
      if (a.length >= MIN_BUCKET_N && b.length >= MIN_BUCKET_N) {
        items.push({
          id: 'latebed_energy',
          label: 'Po zaśnięciu po północy: energia nast. dnia ' + round1(avg(a)) + ' vs wcześniej: ' + round1(avg(b)),
          delta: round1(avg(a) - avg(b)), n: a.length + b.length
        });
      }
    })();

    // 8. Pearson: sleep hours vs deep work
    (function () {
      var xs = [], ys = [];
      sums.forEach(function (s) {
        if (s.sleepH != null && s.deepWork != null) { xs.push(s.sleepH); ys.push(s.deepWork); }
      });
      var p = pearson(xs, ys);
      if (p != null && Math.abs(p) >= 0.3) {
        items.push({
          id: 'sleep_deepwork',
          label: 'Korelacja sen ↔ deep work: r = ' + round1(p * 10) / 10 + ' (' + (p > 0 ? 'dodatnia' : 'ujemna') + ', n=' + xs.length + ')',
          delta: round1(p), n: xs.length
        });
      }
    })();

    // Sort by absolute effect size, strongest first.
    items.sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });
    return { ready: true, daysLogged: sums.length, needed: MIN_DAYS_FOR_PATTERNS, items: items };
  }

  // ---------- weekday profile + day suggestion ----------
  var WEEKDAYS = ['niedziele', 'poniedziałki', 'wtorki', 'środy', 'czwartki', 'piątki', 'soboty'];
  function weekdayProfile() {
    var sums = allSummaries();
    var buckets = [];
    for (var i = 0; i < 7; i++) buckets.push({ energy: [], mood: [] });
    sums.forEach(function (s) {
      var dow = keyToDate(s.key).getDay();
      if (s.energy != null) buckets[dow].energy.push(s.energy);
      if (s.mood != null) buckets[dow].mood.push(s.mood);
    });
    return buckets.map(function (b, i) {
      return { dow: i, label: WEEKDAYS[i], energy: avg(b.energy), mood: avg(b.mood), n: b.energy.length };
    });
  }
  function suggestToday() {
    var sums = allSummaries();
    if (sums.length < MIN_DAYS_FOR_PATTERNS) return null;
    var prof = weekdayProfile();
    var today = prof[new Date().getDay()];
    if (today.energy == null || today.n < 3) return null;
    var e = round1(today.energy);
    if (today.energy <= 4.5) {
      return 'Wzorce: w ' + today.label + ' masz średnio energię ' + e + '/10. Planuj light work i regenerację.';
    }
    if (today.energy >= 7) {
      return 'Wzorce: w ' + today.label + ' masz średnio energię ' + e + '/10. Dobry dzień na deep work i trudne zadania.';
    }
    return 'Wzorce: w ' + today.label + ' masz średnio energię ' + e + '/10.';
  }

  // ---------- export ----------
  function exportJSON() {
    var out = { schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), days: {} };
    listDayKeys().forEach(function (k) { out.days[k] = getDay(k); });
    return JSON.stringify(out, null, 2);
  }
  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var cols = ['key', 'sleepH', 'sleepQ', 'mood', 'energy', 'mealsN', 'fastfood', 'alcohol',
                'moveMin', 'strength', 'cardio', 'deepWork', 'pomodoro', 'weight', 'suppsN'];
    var rows = [cols.join(',')];
    allSummaries().forEach(function (s) {
      rows.push(cols.map(function (c) {
        var v = s[c];
        if (typeof v === 'number') v = Math.round(v * 100) / 100;
        if (typeof v === 'boolean') v = v ? 1 : 0;
        return csvCell(v);
      }).join(','));
    });
    return rows.join('\n');
  }

  // ---------- demo data (30 days with realistic embedded patterns) ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedDemo(nDays) {
    nDays = nDays || 30;
    var rnd = mulberry32(20260612);
    var clamp = function (x, lo, hi) { return Math.max(lo, Math.min(hi, x)); };
    var meals = ['jajecznica', 'owsianka', 'kurczak z ryżem', 'sałatka z tuńczykiem', 'twaróg z warzywami', 'makaron z indykiem'];
    var weight = 82.5;
    var today = dateKey();
    for (var i = nDays; i >= 1; i--) {
      var k = addDays(today, -i);
      var dow = keyToDate(k).getDay();
      var fri = dow === 5, sat = dow === 6, tue = dow === 2;

      // Sleep: shorter after Fri/Sat alcohol nights; alcohol flagged on prev evening.
      var prevAlcohol = (dow === 6 || dow === 0) && rnd() < 0.7;
      var hours = clamp(7.4 + (rnd() - 0.5) * 1.6 - (prevAlcohol ? 1.4 : 0), 4.5, 9.5);
      hours = Math.round(hours * 2) / 2;
      var bedLate = prevAlcohol || rnd() < 0.2;
      var bed = bedLate ? minToHM(0 + Math.floor(rnd() * 90)) : minToHM(22 * 60 + 30 + Math.floor(rnd() * 90));
      var wake = minToHM((hmToMin(bed) + hours * 60) % 1440);
      var quality = clamp(Math.round(hours - 1 + rnd() * 2 - (prevAlcohol ? 1.5 : 0)), 1, 10);

      // Mood/energy: driven by sleep + weekday effect (Tuesdays low) + noise.
      var base = 2.2 + hours * 0.62;
      var energy = clamp(Math.round(base + (tue ? -2.2 : 0) + (rnd() - 0.5) * 2), 1, 10);
      var mood = clamp(Math.round(base + 0.4 + (rnd() - 0.5) * 2), 1, 10);

      var e = emptyDay();
      e.sleep = { start: bed, end: wake, hours: hours, quality: quality };

      var tags = [];
      if (energy <= 4) tags.push('zmęczony');
      if (mood >= 8) tags.push('flow');
      if (tue && rnd() < 0.5) tags.push('stres');
      e.moods.push({ t: '10:' + pad(Math.floor(rnd() * 60)), mood: mood, energy: energy, tags: tags });
      if (rnd() < 0.6) {
        e.moods.push({
          t: '19:' + pad(Math.floor(rnd() * 60)),
          mood: clamp(mood + Math.round((rnd() - 0.5) * 2), 1, 10),
          energy: clamp(energy - 1 + Math.round(rnd() * 2 - 1), 1, 10),
          tags: []
        });
      }

      // Meals: breakfast/lunch/dinner; fastfood ~Fri; alcohol Fri/Sat evenings.
      var alcoholTonight = (fri || sat) && rnd() < 0.7;
      var fastfood = fri && rnd() < 0.6;
      e.meals.push({ t: minToHM(7 * 60 + 40 + Math.floor(rnd() * 50)), name: meals[Math.floor(rnd() * 2)], fastfood: false, alcohol: false });
      e.meals.push({ t: minToHM(12 * 60 + 45 + Math.floor(rnd() * 50)), name: meals[2 + Math.floor(rnd() * 2)], fastfood: false, alcohol: false });
      e.meals.push({
        t: minToHM(19 * 60 + Math.floor(rnd() * 70)),
        name: fastfood ? 'kebab' : meals[4 + Math.floor(rnd() * 2)],
        fastfood: fastfood, alcohol: alcoholTonight
      });

      // Movement: strength Mon/Wed/Fri-ish, cardio sometimes; boosts mood already baked via base.
      if ((dow === 1 || dow === 3 || dow === 5) && rnd() < 0.85) {
        e.moves.push({ t: '17:30', type: 'siłownia', min: 55 + Math.floor(rnd() * 25), kind: 'strength' });
      } else if (rnd() < 0.3) {
        e.moves.push({ t: '18:00', type: 'spacer', min: 30 + Math.floor(rnd() * 30), kind: 'cardio' });
      }
      // Strength bumps mood slightly (post-hoc, to make the pattern visible).
      if (e.moves.some(function (m) { return m.kind === 'strength'; })) {
        e.moods[0].mood = clamp(e.moods[0].mood + 1, 1, 10);
      }

      // Supplements
      if (rnd() < 0.85) e.supps.push({ t: '08:10', name: 'witamina D3' });
      if (rnd() < 0.7)  e.supps.push({ t: '21:30', name: 'magnez' });
      if (rnd() < 0.5)  e.supps.push({ t: '08:10', name: 'omega-3' });

      // Productivity: tracks energy.
      var dw = clamp(Math.round((energy * 0.45 + rnd() * 1.5) * 2) / 2, 0, 6);
      e.prod = { deepWork: dw, pomodoro: Math.round(dw * 2 + rnd() * 2) };

      // Weight: slow downward drift + noise.
      weight = weight - 0.02 + (rnd() - 0.5) * 0.3;
      if (rnd() < 0.8) e.weight = Math.round(weight * 10) / 10;

      sSet('d:' + k, e);
    }
    sSet('meta', { version: SCHEMA_VERSION, demo: true });
    notify();
  }
  function isDemo() { var m = sGet('meta'); return !!(m && m.demo); }
  function wipeAll() {
    listKeys('').forEach(function (k) { sRemove(k); });
    sSet('meta', { version: SCHEMA_VERSION });
    undoStack = [];
    notify();
  }

  migrate();

  // ---------- public API ----------
  window.LifeTracker = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MIN_DAYS_FOR_PATTERNS: MIN_DAYS_FOR_PATTERNS,
    dateKey: dateKey, keyToDate: keyToDate, addDays: addDays,
    nowHM: nowHM, hmToMin: hmToMin, minToHM: minToHM,
    getDay: getDay, saveDay: saveDay, listDayKeys: listDayKeys,
    logSleep: logSleep, logMeal: logMeal, logMood: logMood,
    logMove: logMove, logSupp: logSupp, logProd: logProd, logWeight: logWeight,
    undo: undo, canUndo: canUndo, onChange: onChange,
    mealHistory: mealHistory, suppHistory: suppHistory, moveHistory: moveHistory,
    typicalSleep: typicalSleep,
    summary: summary, allSummaries: allSummaries,
    findings: findings, weekdayProfile: weekdayProfile, suggestToday: suggestToday,
    exportJSON: exportJSON, exportCSV: exportCSV,
    seedDemo: seedDemo, isDemo: isDemo, wipeAll: wipeAll
  };
})();

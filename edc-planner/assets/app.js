(function () {
  "use strict";

  const D = window.EDC;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const STAGE = {};
  D.stages.forEach((s) => (STAGE[s.id] = s));

  const START_MIN = 13 * 60; // 1:00 PM
  const END_MIN = 24 * 60; // midnight
  const PX_PER_MIN = 1.55;
  const MIN_KEEP = 15; // shortest partial set worth walking for
  const ENTRY_BUFFER = 45; // minutes to get through the gates
  const EASTERN_OFFSET = "-05:00"; // Orlando in November (EST)

  // ---------- time helpers ----------
  function toMin(t) {
    const [h, m] = t.split(":").map(Number);
    return (h === 12 ? 24 : h + 12) * 60 + m;
  }
  function fmt(min, withAmPm) {
    min = Math.round(min);
    let h = Math.floor(min / 60), m = min % 60;
    const pm = h < 24;
    h = h % 12 || 12;
    const s = h + ":" + String(m).padStart(2, "0");
    return withAmPm ? s + (pm ? " PM" : " AM") : s;
  }
  function dur(min) {
    min = Math.round(min);
    if (min < 60) return min + " min";
    const h = Math.floor(min / 60), m = min % 60;
    return h + "h" + (m ? " " + m + "m" : "");
  }
  function dayBase(day) {
    return Date.parse(day.date + "T00:00:00" + EASTERN_OFFSET);
  }
  function epochFor(day, min) {
    return dayBase(day) + min * 60000;
  }
  function nowMinFor(day) {
    if (state.demoNow && state.demoNow.day === day.id) return state.demoNow.min;
    return (Date.now() - dayBase(day)) / 60000;
  }
  function liveDay() {
    return D.days.find((d) => {
      const n = nowMinFor(d);
      return n >= START_MIN - 180 && n <= END_MIN + 60;
    });
  }
  function slug(s) {
    return s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  // ---------- build set index ----------
  const SETS = {};
  const BY_DAY = {};
  D.days.forEach((day) => {
    BY_DAY[day.id] = [];
    D.stages.forEach((st) => {
      (day.sets[st.id] || []).forEach((r) => {
        const set = {
          id: day.id + ":" + slug(r[0]),
          day: day.id, stage: st.id, name: r[0],
          start: toMin(r[1]), end: toMin(r[2]),
          genre: r[3] || "", note: r[4] || ""
        };
        SETS[set.id] = set;
        BY_DAY[day.id].push(set);
      });
    });
  });
  const DAY = {};
  D.days.forEach((d) => (DAY[d.id] = d));

  // ---------- state ----------
  const DEFAULTS = { picks: {}, day: null, view: "schedule", pace: 1, lead: 10, remind: false, demoNow: null };
  let state = Object.assign({}, DEFAULTS);
  try {
    const raw = window.Native ? window.Native.load() : localStorage.getItem("edc-state");
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (e) { /* fresh start */ }
  // drop picks for sets that no longer exist
  Object.keys(state.picks).forEach((k) => { if (!SETS[k]) delete state.picks[k]; });
  if (!state.day || !DAY[state.day]) state.day = (liveDay() || D.days[0]).id;
  state.demoNow = null;

  function save() {
    const json = JSON.stringify(state);
    try {
      if (window.Native) window.Native.save(json);
      else localStorage.setItem("edc-state", json);
    } catch (e) { /* ignore */ }
  }

  // ---------- walking ----------
  function walk(a, b) {
    if (!a || !b || a === b) return 0;
    const base = D.walk[a + "-" + b] || D.walk[b + "-" + a] || 10;
    return Math.round(base * state.pace);
  }

  // ---------- planner ----------
  // Turns the picked sets of a day into a conflict-free route with walking time.
  function buildPlan(dayId) {
    const picked = BY_DAY[dayId]
      .filter((s) => state.picks[s.id])
      .map((s) => ({ set: s, prio: state.picks[s.id], from: s.start, to: s.end, cutStart: false, cutEnd: false }))
      .sort((a, b) => a.set.start - b.set.start || b.prio - a.prio || a.set.end - b.set.end);

    const route = [];
    const skipped = [];
    let clashes = 0;

    for (const node of picked) {
      let placed = true;
      while (route.length) {
        const prev = route[route.length - 1];
        const w = walk(prev.set.stage, node.set.stage);
        if (node.from >= prev.to + w) break; // fits
        clashes++;
        if (node.prio > prev.prio) {
          prev.to = node.from - w; prev.cutEnd = true;
        } else if (prev.prio > node.prio) {
          node.from = prev.to + w; node.cutStart = true;
        } else {
          // same priority: split the clash down the middle (rounded to 5 min)
          const leave = Math.round((node.from + prev.to - w) / 2 / 5) * 5;
          const leaveClamped = Math.max(prev.from, Math.min(leave, prev.to));
          if (leaveClamped < prev.to) { prev.to = leaveClamped; prev.cutEnd = true; }
          if (leaveClamped + w > node.from) { node.from = leaveClamped + w; node.cutStart = true; }
        }
        if (prev.to - prev.from < MIN_KEEP) {
          // previous set got squeezed out: drop it and re-check against the one before
          route.pop();
          prev.reason = "Clashes with " + node.set.name;
          skipped.push(prev);
          // node may only have been pushed back by the dropped set
          node.from = node.set.start; node.cutStart = false;
          continue;
        }
        if (node.to - node.from < MIN_KEEP) {
          node.reason = "Clashes with " + prev.set.name;
          skipped.push(node);
          placed = false;
        }
        break;
      }
      if (placed) route.push(node);
    }

    // Steps between sets: walking + free time
    let music = 0, walking = 0;
    route.forEach((n, i) => {
      music += n.to - n.from;
      const prev = route[i - 1];
      if (prev) {
        n.walk = walk(prev.set.stage, n.set.stage);
        n.leaveBy = n.from - n.walk;
        n.gap = n.from - n.walk - prev.to;
        walking += n.walk;
      } else {
        n.walk = 0; n.gap = 0;
      }
    });
    return { route, skipped, clashes, music, walking };
  }

  // ---------- rendering: day chips ----------
  function renderDays() {
    const live = liveDay();
    $("#days").innerHTML = D.days.map((d) => {
      const n = BY_DAY[d.id].filter((s) => state.picks[s.id]).length;
      return `<button data-day="${d.id}" class="${d.id === state.day ? "active" : ""}">
        ${d.label}${live && live.id === d.id ? " •" : ""}<small>NOV ${d.date.slice(-1)}</small>
        ${n ? `<span class="dot">${n}</span>` : ""}</button>`;
    }).join("");
    const total = Object.keys(state.picks).length;
    $("#plan-count").textContent = total ? total : "";
  }

  // ---------- rendering: schedule grid ----------
  let planCache = {};
  function planFor(dayId) {
    if (!planCache[dayId]) planCache[dayId] = buildPlan(dayId);
    return planCache[dayId];
  }

  function renderGrid() {
    const day = DAY[state.day];
    const height = (END_MIN - START_MIN) * PX_PER_MIN + 10;
    $("#stage-head").innerHTML = "<span></span>" + D.stages.map((s) =>
      `<div style="--c:${s.color}">${s.short}</div>`).join("");

    const plan = planFor(day.id);
    const cut = {}, skip = {};
    plan.route.forEach((n) => { if (n.cutStart || n.cutEnd) cut[n.set.id] = n; });
    plan.skipped.forEach((n) => (skip[n.set.id] = n));
    const nowMin = nowMinFor(day);

    let html = `<div class="timecol" style="height:${height}px">`;
    for (let m = START_MIN; m <= END_MIN; m += 60) {
      html += `<span style="top:${(m - START_MIN) * PX_PER_MIN + 2}px">${fmt(m)}</span>`;
    }
    html += "</div>";
    D.stages.forEach((st) => {
      html += `<div class="col" style="height:${height}px;--c:${st.color}">`;
      BY_DAY[day.id].filter((s) => s.stage === st.id).forEach((s) => {
        const top = (s.start - START_MIN) * PX_PER_MIN + 2;
        const h = Math.max(24, (s.end - s.start) * PX_PER_MIN - 3);
        const p = state.picks[s.id];
        const cls = ["set", p === 2 ? "must" : p === 1 ? "want" : "", h < 62 ? "short" : "", h < 40 ? "tiny" : "",
          nowMin > s.end ? "past" : ""].join(" ");
        const warn = skip[s.id] ? `<span class="warn skip">skip</span>`
          : cut[s.id] ? `<span class="warn">${fmt(cut[s.id].from)}–${fmt(cut[s.id].to)}</span>` : "";
        html += `<div class="${cls}" data-set="${s.id}" style="top:${top}px;height:${h}px">
          <span class="mark">${p === 2 ? "♥" : p === 1 ? "★" : ""}</span>
          <div class="nm">${esc(s.name)}</div>
          <div class="tm">${fmt(s.start)}–${fmt(s.end)}${s.note === "Sunset" ? ' <span class="sun">☀</span>' : ""}</div>
          <div class="gn">${esc(s.genre)}</div>${warn}</div>`;
      });
      html += "</div>";
    });
    for (let m = START_MIN + 60; m < END_MIN; m += 60) {
      html += `<div class="hourline" style="top:${(m - START_MIN) * PX_PER_MIN + 2}px"></div>`;
    }
    if (nowMin >= START_MIN && nowMin <= END_MIN) {
      html += `<div class="nowline" style="top:${(nowMin - START_MIN) * PX_PER_MIN + 2}px"></div>`;
    }
    $("#grid").innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---------- picks ----------
  function cyclePick(id) {
    const p = state.picks[id] || 0;
    const next = (p + 1) % 3;
    if (next) state.picks[id] = next; else delete state.picks[id];
    changed();
    const s = SETS[id];
    toast(next === 2 ? `♥ Must-see: ${s.name}` : next === 1 ? `★ Added ${s.name}` : `Removed ${s.name}`);
  }
  function setPick(id, v) {
    if (v) state.picks[id] = v; else delete state.picks[id];
    changed();
  }
  function changed() {
    planCache = {};
    save();
    renderAll();
    syncReminders();
  }

  // ---------- search ----------
  function renderSearch() {
    const q = $("#search").value.trim().toLowerCase();
    const box = $("#search-results");
    const searching = !$("#searchbar").hidden && q.length > 0;
    box.hidden = !searching;
    $("#grid-wrap").hidden = searching;
    $("#hint").hidden = searching;
    $("#days").hidden = searching;
    if (!searching) return;
    const hits = Object.values(SETS).filter((s) =>
      s.name.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q) || STAGE[s.stage].name.toLowerCase().includes(q));
    box.innerHTML = hits.length ? hits.map((s) => {
      const p = state.picks[s.id] || 0;
      return `<div class="res" data-set="${s.id}" style="--c:${STAGE[s.stage].color}">
        <div class="info"><div class="nm">${esc(s.name)}</div>
        <div class="meta">${DAY[s.day].name} · ${STAGE[s.stage].name} · ${fmt(s.start)}–${fmt(s.end)} · ${esc(s.genre)}</div></div>
        <div class="mk ${p === 2 ? "must" : p === 1 ? "want" : ""}">${p === 2 ? "♥" : p === 1 ? "★" : "☆"}</div></div>`;
    }).join("") : `<div class="empty">No artists match “${esc(q)}”.</div>`;
  }

  // ---------- rendering: plan ----------
  function renderPlan() {
    const day = DAY[state.day];
    const plan = planFor(day.id);
    const el = $("#plan");
    if (!plan.route.length && !plan.skipped.length) {
      el.innerHTML = `<div class="empty"><div style="font-size:42px">✨</div>
        <p><b>No sets picked for ${day.name} yet.</b></p>
        <p>Go to <b>Schedule</b> and tap the sets you want to see. Tap twice to mark a must-see. I'll work out the clashes, walking time and when to leave each stage.</p>
        <button class="big-btn" data-go="schedule">Pick sets</button></div>`;
      return;
    }
    const nowMin = nowMinFor(day);
    let html = `<div class="plan-sum">
      <div><b>${plan.route.length}</b><span>Sets</span></div>
      <div><b>${dur(plan.music)}</b><span>Music</span></div>
      <div><b>${plan.walking} min</b><span>Walking</span></div></div>`;

    // live banner
    if (nowMin >= START_MIN - 180 && nowMin <= END_MIN) {
      const cur = plan.route.find((n) => nowMin >= n.from && nowMin < n.to);
      const nxt = plan.route.find((n) => n.from > nowMin);
      let msg = "";
      if (cur) msg += `Now: <b>${esc(cur.set.name)}</b> at ${STAGE[cur.set.stage].name} until ${fmt(cur.to, true)}. `;
      if (nxt) {
        const leave = nxt.leaveBy != null ? nxt.leaveBy : nxt.from - 15;
        const inMin = Math.round(leave - nowMin);
        msg += `Next: <b>${esc(nxt.set.name)}</b> — ${inMin > 0 ? `head to ${STAGE[nxt.set.stage].name} in <b>${dur(inMin)}</b>` : `go to ${STAGE[nxt.set.stage].name} <b>now</b>`}.`;
      }
      if (!cur && !nxt) msg = "That's a wrap for today's plan. Drink some water! 💧";
      html += `<div class="banner live">${msg}</div>`;
    }
    if (plan.clashes) {
      html += `<div class="banner warn">⚠ ${plan.clashes} clash${plan.clashes > 1 ? "es" : ""} sorted out. ♥ Must-sees play in full; sets with equal priority are split down the middle. Tap ♥ on a set to protect it.</div>`;
    }

    const first = plan.route[0];
    if (first) {
      html += `<div class="move"><span class="ico">🎟</span><span>Be at the gates by <b>${fmt(first.from - ENTRY_BUFFER, true)}</b> to get in for ${esc(first.set.name)}.</span></div>`;
    }
    plan.route.forEach((n, i) => {
      const st = STAGE[n.set.stage];
      if (i > 0) {
        const prev = plan.route[i - 1];
        if (n.walk > 0) {
          html += `<div class="move"><span class="ico">🚶</span><span>Leave ${STAGE[prev.set.stage].short} at <b>${fmt(n.leaveBy, true)}</b> · ${n.walk} min walk to ${st.name}</span>
            <button class="mapbtn" data-route="${prev.set.stage},${n.set.stage}">Map</button></div>`;
        } else if (n.from > prev.to) {
          html += `<div class="move"><span class="ico">📍</span><span>Stay at ${st.name}</span></div>`;
        }
        if (n.gap >= 20) {
          html += `<div class="move"><span class="ico">☕</span><span>${dur(n.gap)} free. Good time for water, food or a bathroom stop.</span></div>`;
        }
      }
      const isNow = nowMin >= n.from && nowMin < n.to;
      const chips = [];
      if (!n.cutStart && !n.cutEnd) chips.push(`<span class="chip ok">Full set</span>`);
      if (n.cutStart) chips.push(`<span class="chip cut">Arrive ${fmt(n.from)}</span>`);
      if (n.cutEnd) chips.push(`<span class="chip cut">Leave ${fmt(n.to)}</span>`);
      if (n.set.note === "Sunset") chips.push(`<span class="chip sun">☀ Sunset</span>`);
      else if (n.set.note) chips.push(`<span class="chip">${esc(n.set.note)}</span>`);
      chips.push(`<button class="chip btn ${n.prio === 2 ? "on" : ""}" data-must="${n.set.id}">♥ Must-see</button>`);
      html += `<div class="step" style="--c:${st.color}"><div class="rail"><div class="dotc"></div><div class="ln"></div></div>
        <div class="card ${isNow ? "is-now" : ""}">
          <div class="row1"><div><div class="nm">${esc(n.set.name)}</div><div class="stg">${st.name} · ${esc(n.set.genre)}</div></div>
          <span style="flex:1"></span><button class="x" data-remove="${n.set.id}" aria-label="Remove">✕</button></div>
          <div class="when">${fmt(n.from, true)} – ${fmt(n.to, true)}</div>
          ${n.cutStart || n.cutEnd ? `<div class="full">Full set ${fmt(n.set.start)}–${fmt(n.set.end, true)}</div>` : ""}
          <div class="chips">${chips.join("")}</div>
        </div></div>`;
    });

    if (plan.skipped.length) {
      html += `<div class="skipped"><h3>Won't fit</h3>`;
      plan.skipped.forEach((n) => {
        const st = STAGE[n.set.stage];
        html += `<div class="step" style="--c:${st.color}"><div class="rail"></div><div class="card">
          <div class="row1"><div><div class="nm">${esc(n.set.name)}</div><div class="stg">${st.name} · ${fmt(n.set.start)}–${fmt(n.set.end, true)}</div></div>
          <span style="flex:1"></span><button class="x" data-remove="${n.set.id}">✕</button></div>
          <div class="full">${esc(n.reason || "Clashes with another pick")}. Mark it ♥ to swap it in.</div>
          <div class="chips"><button class="chip btn ${n.prio === 2 ? "on" : ""}" data-must="${n.set.id}">♥ Must-see</button></div></div></div>`;
      });
      html += `</div>`;
    }

    html += `<div class="plan-actions"><h3>Plan tools</h3>
      <button class="big-btn" id="share-plan">Share my plan</button>
      <button class="big-btn ghost" id="open-settings">${state.remind ? "🔔 Reminders on · " + state.lead + " min before" : "🔕 Turn on reminders"}</button></div>`;
    el.innerHTML = html;
  }

  // ---------- map ----------
  let mapRoute = null; // [fromStage, toStage], null = auto (next walk), "none" = cleared
  function renderMap() {
    const day = DAY[state.day];
    const nowMin = nowMinFor(day);
    const live = nowMin >= START_MIN && nowMin <= END_MIN;
    const plan = planFor(day.id);

    if (!mapRoute) {
      // default: next walk in the plan when live
      const nxt = plan.route.find((n) => n.from > nowMin && n.walk > 0);
      if (live && nxt) {
        const idx = plan.route.indexOf(nxt);
        mapRoute = [plan.route[idx - 1].set.stage, nxt.set.stage];
      }
    }

    // what's on at each stage (now, or next up)
    const refMin = live ? nowMin : null;
    let pins = "";
    D.stages.forEach((st) => {
      const [x, y] = D.mapPins[st.id];
      const sets = BY_DAY[day.id].filter((s) => s.stage === st.id);
      let sub = "";
      if (refMin != null) {
        const cur = sets.find((s) => refMin >= s.start && refMin < s.end);
        sub = cur ? "Now: " + cur.name : "";
      } else {
        const mine = plan.route.filter((n) => n.set.stage === st.id).length;
        sub = mine ? `${mine} in your plan` : "";
      }
      const cls = Array.isArray(mapRoute) ? (mapRoute[0] === st.id ? "from" : mapRoute[1] === st.id ? "to" : "dim") : "";
      pins += `<div class="pin ${cls}" style="left:${x * 100}%;top:${y * 100}%;--c:${st.color}">
        <div class="lbl">${st.name.toUpperCase()}${sub ? `<small>${esc(sub)}</small>` : ""}</div><div class="tip"></div></div>`;
    });
    $("#map-pins").innerHTML = pins;

    let svg = "";
    let info = `Tap <b>Map</b> on a walking step in My Plan to see the route.`;
    if (Array.isArray(mapRoute)) {
      const a = D.mapPins[mapRoute[0]], b = D.mapPins[mapRoute[1]];
      const ax = a[0] * 1000, ay = a[1] * 1250 + 8, bx = b[0] * 1000, by = b[1] * 1250 + 8;
      const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.abs(bx - ax) * 0.18;
      svg = `<path class="route" d="M${ax},${ay} Q${mx},${my} ${bx},${by}"/>`;
      info = `🚶 <b>${STAGE[mapRoute[0]].name}</b> → <b>${STAGE[mapRoute[1]].name}</b>: about <b>${walk(mapRoute[0], mapRoute[1])} min</b> walk. <a href="#" id="clear-route" style="color:var(--circuit)">Clear</a>`;
    }
    $("#map-svg").innerHTML = svg;
    $("#map-info").innerHTML = info;

    // walk matrix
    let t = `<table><caption>Walking times (min) · ${paceName()}</caption><tr><th></th>${D.stages.map((s) => `<th style="--c:${s.color}">${s.short}</th>`).join("")}</tr>`;
    D.stages.forEach((a) => {
      t += `<tr><th style="--c:${a.color}">${a.short}</th>${D.stages.map((b) => `<td>${a.id === b.id ? "–" : walk(a.id, b.id)}</td>`).join("")}</tr>`;
    });
    $("#walk-table").innerHTML = t + "</table>";
  }

  function paceName() {
    return state.pace < 1 ? "quick pace" : state.pace > 1 ? "chill pace" : "normal pace";
  }

  // ---------- posters ----------
  function renderPosters() {
    const img = $("#poster-img");
    const src = DAY[state.day].poster;
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  }

  // ---------- zoom boxes (pinch + buttons) ----------
  function makeZoom(box, inner) {
    let scale = 1;
    function apply(newScale, cx, cy) {
      newScale = Math.max(1, Math.min(5, newScale));
      const rect = box.getBoundingClientRect();
      const fx = cx == null ? rect.width / 2 : cx - rect.left;
      const fy = cy == null ? rect.height / 2 : cy - rect.top;
      const px = (box.scrollLeft + fx) / scale, py = (box.scrollTop + fy) / scale;
      scale = newScale;
      inner.style.width = scale * 100 + "%";
      box.scrollLeft = px * scale - fx;
      box.scrollTop = py * scale - fy;
    }
    let pinch = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    box.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) {
        pinch = { d: dist(e.touches), s: scale };
        e.preventDefault();
      }
    }, { passive: false });
    box.addEventListener("touchmove", (e) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        apply(pinch.s * dist(e.touches) / pinch.d, cx, cy);
      }
    }, { passive: false });
    box.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; });
    let lastTap = 0;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-z]");
      if (b) {
        const z = b.dataset.z;
        apply(z === "+" ? scale * 1.5 : z === "-" ? scale / 1.5 : 1);
        return;
      }
      const now = Date.now();
      if (now - lastTap < 300) apply(scale > 1.5 ? 1 : 2.5, e.clientX, e.clientY);
      lastTap = now;
    });
    return { reset: () => apply(1) };
  }

  // ---------- reminders ----------
  function syncReminders() {
    if (!window.Native) return;
    const list = [];
    if (state.remind) {
      D.days.forEach((day) => {
        const plan = planFor(day.id);
        plan.route.forEach((n, i) => {
          const st = STAGE[n.set.stage];
          const leave = i === 0 ? n.from - 15 : n.leaveBy;
          const at = epochFor(day, leave - state.lead);
          const how = i === 0 ? "" : n.walk ? ` It's a ${n.walk} min walk, so leave ${STAGE[plan.route[i - 1].set.stage].short} by ${fmt(leave)}.` : "";
          list.push({
            id: hash(n.set.id),
            at,
            title: `${n.set.name} · ${fmt(n.from, true)}`,
            text: `${st.name}${n.cutStart ? " (arriving late)" : ""}.${how}`
          });
        });
      });
    }
    try { window.Native.setReminders(JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  function hash(s) {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 2000000000;
  }

  // ---------- share ----------
  function planText() {
    let out = "🎶 My EDC Orlando 2026 plan\n";
    D.days.forEach((day) => {
      const plan = planFor(day.id);
      if (!plan.route.length) return;
      out += `\n${day.name.toUpperCase()}\n`;
      plan.route.forEach((n) => {
        out += `${fmt(n.from)}–${fmt(n.to)}  ${n.prio === 2 ? "♥ " : ""}${n.set.name} @ ${STAGE[n.set.stage].name}\n`;
      });
    });
    return out;
  }

  // ---------- settings sheet ----------
  function openSheet(html) {
    $("#sheet").innerHTML = `<div class="grab"></div>` + html;
    $("#sheet").hidden = false;
    $("#sheet-bg").hidden = false;
  }
  function closeSheet() {
    $("#sheet").hidden = true;
    $("#sheet-bg").hidden = true;
  }
  function openSettings() {
    const notifOk = window.Native ? window.Native.notificationsAllowed() : true;
    openSheet(`<h2>Settings</h2>
      <div class="opt"><label>Walking pace</label><div class="seg" data-opt="pace">
        <button data-v="0.8" class="${state.pace < 1 ? "on" : ""}">Quick</button>
        <button data-v="1" class="${state.pace === 1 ? "on" : ""}">Normal</button>
        <button data-v="1.3" class="${state.pace > 1 ? "on" : ""}">Chill / crowded</button></div>
        <p>Changes the walking times between stages and when you should leave.</p></div>
      <div class="opt"><label>Reminders</label><div class="seg" data-opt="remind">
        <button data-v="0" class="${!state.remind ? "on" : ""}">Off</button>
        <button data-v="1" class="${state.remind ? "on" : ""}">On</button></div>
        ${state.remind && !notifOk ? `<p style="color:var(--warn)">Notifications are blocked. Allow them for EDC Planner in your phone's Settings → Apps.</p>` : ""}
        <p>You'll get a notification before it's time to walk to your next set.</p></div>
      <div class="opt"><label>Remind me</label><div class="seg" data-opt="lead">
        ${[5, 10, 15, 20].map((v) => `<button data-v="${v}" class="${state.lead === v ? "on" : ""}">${v} min</button>`).join("")}</div>
        <p>How long before you need to leave.</p></div>
      ${state.remind && window.Native ? `<button class="big-btn ghost" id="test-notif" style="margin-bottom:10px">Send a test notification</button>` : ""}
      <button class="big-btn ghost" id="clear-picks">Clear all picks</button>
      <p style="font-size:11px;color:var(--dim);margin-top:14px">Set times come from the official day posters. Walking times are estimates from the festival map. Times shown are Orlando time (EST).</p>`);
  }

  // ---------- view switching ----------
  const mapZoom = makeZoom($("#map-box"), $("#map-inner"));
  makeZoom($("#poster-box"), $("#poster-inner"));

  function setView(v) {
    state.view = v;
    $$(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + v));
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    if (v !== "schedule") closeSearch();
    renderAll();
    save();
  }

  function renderAll() {
    renderDays();
    if (state.view === "schedule") { renderGrid(); renderSearch(); }
    if (state.view === "plan") renderPlan();
    if (state.view === "map") renderMap();
    if (state.view === "posters") renderPosters();
  }

  function closeSearch() {
    $("#searchbar").hidden = true;
    $("#search").value = "";
    renderSearch();
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 1600);
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const t = e.target;
    let el;
    if ((el = t.closest("#days button"))) {
      state.day = el.dataset.day; mapRoute = null; save(); renderAll();
      if (state.view === "schedule") $("#view-schedule").scrollTop = 0;
      return;
    }
    if ((el = t.closest("#tabs button"))) { setView(el.dataset.view); return; }
    if ((el = t.closest("[data-set]"))) { cyclePick(el.dataset.set); return; }
    if ((el = t.closest("[data-remove]"))) { const s = SETS[el.dataset.remove]; setPick(s.id, 0); toast("Removed " + s.name); return; }
    if ((el = t.closest("[data-must]"))) {
      const id = el.dataset.must;
      setPick(id, state.picks[id] === 2 ? 1 : 2);
      toast(state.picks[id] === 2 ? "♥ Must-see: " + SETS[id].name : "★ Regular pick: " + SETS[id].name);
      return;
    }
    if ((el = t.closest("[data-route]"))) { mapRoute = el.dataset.route.split(","); setView("map"); mapZoom.reset(); return; }
    if ((el = t.closest("[data-go]"))) { setView(el.dataset.go); return; }
    if (t.closest("#clear-route")) { e.preventDefault(); mapRoute = "none"; renderMap(); return; }
    if (t.closest("#btn-search")) {
      if (state.view !== "schedule") setView("schedule");
      $("#searchbar").hidden = false; $("#search").focus(); renderSearch(); return;
    }
    if (t.closest("#search-close")) { closeSearch(); return; }
    if (t.closest("#btn-settings") || t.closest("#open-settings")) { openSettings(); return; }
    if (t.closest("#share-plan")) {
      const txt = planText();
      if (window.Native) window.Native.share(txt);
      else if (navigator.share) navigator.share({ text: txt });
      else { navigator.clipboard && navigator.clipboard.writeText(txt); toast("Plan copied"); }
      return;
    }
    if (t.closest("#sheet-bg")) { closeSheet(); return; }
    if ((el = t.closest("#sheet .seg button"))) {
      const opt = el.parentElement.dataset.opt, v = Number(el.dataset.v);
      if (opt === "pace") state.pace = v;
      if (opt === "lead") state.lead = v;
      if (opt === "remind") {
        state.remind = !!v;
        if (v && window.Native) window.Native.requestNotifications();
      }
      changed(); openSettings(); return;
    }
    if (t.closest("#test-notif")) { window.Native.testNotification(); return; }
    if (t.closest("#clear-picks")) {
      if (confirm("Remove every set from your plan?")) { state.picks = {}; changed(); closeSheet(); toast("All picks cleared"); }
      return;
    }
  });

  $("#search").addEventListener("input", () => { renderSearch(); $("#view-schedule").scrollTop = 0; });

  window.onBack = function () {
    if (!$("#sheet").hidden) { closeSheet(); return true; }
    if (!$("#searchbar").hidden) { closeSearch(); return true; }
    if (state.view !== "schedule") { setView("schedule"); return true; }
    return false;
  };
  window.onAppResume = function () { planCache = {}; renderAll(); };

  // demo hook for testing the "live" features: EDC_DEMO("sat", "8:15")
  window.EDC_DEMO = function (dayId, t) { state.demoNow = dayId ? { day: dayId, min: toMin(t) } : null; state.day = dayId || state.day; renderAll(); };

  setInterval(() => { if (!document.hidden) renderAll(); }, 60000);

  setView(state.view || "schedule");
  // jump grid near "now" when live
  const ld = liveDay();
  if (ld && ld.id === state.day) {
    const n = nowMinFor(ld);
    if (n > START_MIN) $("#view-schedule").scrollTop = Math.max(0, (n - START_MIN) * PX_PER_MIN - 120);
  }
  syncReminders();
})();

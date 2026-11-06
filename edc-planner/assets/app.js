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
  const DEFAULTS = { picks: {}, day: null, view: "schedule", pace: 1, lead: 10, remind: false, demoNow: null, me: "", friends: [] };
  let state = Object.assign({}, DEFAULTS);
  try {
    const raw = window.Native ? window.Native.load() : localStorage.getItem("edc-state");
    if (raw) Object.assign(state, JSON.parse(raw));
  } catch (e) { /* fresh start */ }
  // drop picks for sets that no longer exist
  Object.keys(state.picks).forEach((k) => { if (!SETS[k]) delete state.picks[k]; });
  if (!Array.isArray(state.friends)) state.friends = [];
  state.friends.forEach((f) => Object.keys(f.picks || {}).forEach((k) => { if (!SETS[k]) delete f.picks[k]; }));
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
  function buildPlan(dayId, picks) {
    picks = picks || state.picks;
    const picked = BY_DAY[dayId]
      .filter((s) => picks[s.id])
      .map((s) => ({ set: s, prio: picks[s.id], from: s.start, to: s.end, cutStart: false, cutEnd: false }))
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
  // who: undefined for you, or a friend id
  function planFor(dayId, who) {
    const key = dayId + "|" + (who || "");
    if (!planCache[key]) {
      const f = who && friendById(who);
      planCache[key] = buildPlan(dayId, f ? f.picks : state.picks);
    }
    return planCache[key];
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
          <div class="gn">${esc(s.genre)}</div>${warn}${crewDots(s.id)}</div>`;
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

  function crewDots(id) {
    const fr = visibleFriends().filter((f) => f.picks[id]);
    return fr.length ? `<div class="crew-dots">${fr.map((f) => `<i style="background:${f.color}"></i>`).join("")}</div>` : "";
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
    markDirty();
    save();
    renderAll();
    syncReminders();
    if (sheetFriend && !$("#sheet").hidden) openFriend(sheetFriend);
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
      const buds = friendsWith(day.id, n);
      if (buds.length) chips.push(`<span class="chip crew">👥 ${buds.map((f) => esc(f.name)).join(", ")}</span>`);
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
    $("#map-pins").innerHTML = pins + mapCrewHtml();

    let svg = "";
    let info = mapTransform() ? `Map calibrated ✓ <a href="#" id="calib-reset" style="color:var(--circuit)">Reset</a>${state.meet ? ` · <a href="#" id="meet-clear" style="color:var(--circuit)">Clear meet-up</a>` : ""}`
      : `Tap <b>📍 I'm here</b> at two spots during the festival to put your crew on the map.${state.meet ? ` <a href="#" id="meet-clear" style="color:var(--circuit)">Clear meet-up</a>` : ""}`;
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
      if (box.classList.contains("picking")) return; // placing a pin / calibrating: no double-tap zoom
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
  function planText(title) {
    let out = "🎶 " + (title || "My EDC Orlando 2026 plan") + "\n";
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
    sheetFriend = null;
    $("#sheet").hidden = true;
    $("#sheet-bg").hidden = true;
  }
  function openSettings() {
    sheetFriend = null;
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

  // ---------- crew (friends' plans) ----------
  // A crew code packs a name + every pick (2 bits per set) into a short text you can message:
  //   EDC1.<base64url name>.<base64url picks + checksum>
  const ALL_IDS = Object.keys(SETS); // fixed order: day → stage → set, as in data.js
  const CREW_COLORS = ["#ffd84d", "#29c6ff", "#ff8a3d", "#39ff6a", "#b44dff", "#7df9ff", "#ff4fa0", "#e8e8e8"];
  const CODE_RE = /EDC1\.([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{4,})/g;

  function b64e(bytes) {
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64d(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  }
  function checksum(bytes, n) {
    let sum = 7;
    for (let i = 0; i < n; i++) sum = (sum * 31 + bytes[i]) & 255;
    return sum;
  }
  function encodeCode(name, picks) {
    const n = Math.ceil(ALL_IDS.length / 4);
    const bytes = new Uint8Array(n + 1);
    ALL_IDS.forEach((id, i) => { bytes[i >> 2] |= (picks[id] || 0) << ((i & 3) * 2); });
    bytes[n] = checksum(bytes, n);
    return "EDC1." + b64e(new TextEncoder().encode(name)) + "." + b64e(bytes);
  }
  function decodeCode(nameB64, bitsB64) {
    try {
      const name = new TextDecoder("utf-8", { fatal: true }).decode(b64d(nameB64)).trim().slice(0, 24);
      const picks = decodeBits(bitsB64);
      return name && picks ? { name, picks } : null;
    } catch (e) {
      return null;
    }
  }
  function decodeBits(bitsB64) {
    try {
      const bytes = b64d(bitsB64);
      const n = Math.ceil(ALL_IDS.length / 4);
      if (bytes.length !== n + 1 || bytes[n] !== checksum(bytes, n)) return null;
      const picks = {};
      ALL_IDS.forEach((id, i) => {
        const v = (bytes[i >> 2] >> ((i & 3) * 2)) & 3;
        if (v === 1 || v === 2) picks[id] = v;
      });
      return picks;
    } catch (e) {
      return null;
    }
  }
  function myCode() {
    return encodeCode(state.me || "Friend", state.picks);
  }

  function friendById(id) {
    return state.friends.find((f) => f.id === id);
  }
  function visibleFriends() {
    return state.friends.filter((f) => !f.hidden);
  }
  function initial(name) {
    return esc(Array.from(name.trim())[0] || "?").toUpperCase();
  }
  function avatar(p, big) {
    return `<span class="av${big ? " big" : ""}" style="--c:${p.color}" title="${esc(p.name)}">${initial(p.name)}</span>`;
  }
  function meAsPerson() {
    return { id: "", name: state.me || "You", color: "#c6ff3d", picks: state.picks, me: true };
  }

  // Imports every crew code found in a block of text (a pasted or shared message).
  function importCrewText(text) {
    if (!text) return false;
    if (handleInvite(text)) return true;
    const found = Array.from(String(text).matchAll(CODE_RE));
    if (!found.length) { toast("No crew code or invite link found in that text"); return false; }
    const msgs = [];
    found.forEach((m) => {
      const c = decodeCode(m[1], m[2]);
      if (!c) { msgs.push("One code was damaged. Ask for it again"); return; }
      if (state.me && c.name.toLowerCase() === state.me.toLowerCase() && encodeCode(c.name, c.picks) === myCode()) {
        msgs.push("That's your own code");
        return;
      }
      const id = c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "friend-" + hash(c.name);
      const n = Object.keys(c.picks).length;
      const existing = friendById(id);
      if (existing) {
        existing.picks = c.picks; existing.name = c.name; existing.updated = Date.now();
        msgs.push(`Updated ${c.name} (${n} picks)`);
      } else {
        const used = state.friends.map((f) => f.color);
        const color = CREW_COLORS.find((col) => !used.includes(col)) || CREW_COLORS[state.friends.length % CREW_COLORS.length];
        state.friends.push({ id, name: c.name, color, picks: c.picks, updated: Date.now(), hidden: false });
        msgs.push(`Added ${c.name} (${n} picks)`);
      }
    });
    changed();
    toast(msgs.join(" · "));
    return true;
  }

  function shareMyCode() {
    if (!state.me) { toast("Add your name first"); $("#me-name") && $("#me-name").focus(); return; }
    const txt = planText(state.me + "'s EDC Orlando 2026 plan") +
      "\nGot EDC Planner? Share this message to the app, or copy it and tap Paste in the Crew tab.\n\n" + myCode();
    if (window.Native) window.Native.share(txt);
    else if (navigator.share) navigator.share({ text: txt });
    else copyText(txt);
  }
  function copyText(t) {
    if (window.Native) window.Native.copy(t);
    else if (navigator.clipboard) navigator.clipboard.writeText(t);
    toast("Copied");
  }
  function pasteCrew() {
    if (window.Native) { importCrewText(window.Native.paste()); return; }
    if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(importCrewText, () => toast("Paste the code in the box instead"));
  }

  function nodeAt(route, t) {
    return route.find((n) => t >= n.from && t < n.to);
  }

  // Stretches of the day where you and at least one friend are at the same set.
  function hangouts(dayId) {
    const mine = planFor(dayId).route;
    const fr = visibleFriends().map((f) => ({ f, route: planFor(dayId, f.id).route }));
    // check each slice between consecutive arrive/leave times
    const cuts = new Set();
    mine.concat(...fr.map((x) => x.route)).forEach((n) => { cuts.add(n.from); cuts.add(n.to); });
    const times = Array.from(cuts).sort((x, y) => x - y);
    const segs = [];
    let cur = null;
    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i], b = times[i + 1], mid = (a + b) / 2;
      const m = nodeAt(mine, mid);
      const withF = m ? fr.filter((x) => { const n = nodeAt(x.route, mid); return n && n.set.id === m.set.id; }).map((x) => x.f) : [];
      const key = m && withF.length ? m.set.id + "|" + withF.map((f) => f.id).join(",") : null;
      if (cur && cur.key === key && cur.to === a) { cur.to = b; continue; }
      if (cur) segs.push(cur);
      cur = key ? { key, set: m.set, from: a, to: b, people: withF } : null;
    }
    if (cur) segs.push(cur);
    return segs;
  }

  // Friends whose plans put them at this set while you're there.
  function friendsWith(dayId, node) {
    return visibleFriends().filter((f) =>
      planFor(dayId, f.id).route.some((n) => n.set.id === node.set.id && n.from < node.to && n.to > node.from));
  }

  // ---------- live sync (edc-sync server) ----------
  // Picks are always saved on the phone first. When there's signal, your picks are uploaded
  // and everyone else's are downloaded. With no signal the app just uses the last copy it got.
  const INVITE_APP_RE = /edcplanner:\/\/join\?s=([^&\s]+)&t=([A-Za-z0-9_-]{22,64})/;
  const INVITE_WEB_RE = /(https?:\/\/[^\s#]+?)\/join#([A-Za-z0-9_-]{22,64})/;
  let syncing = false, syncTimer = null;

  function randId(bytes) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return b64e(a);
  }
  function normServer(u) {
    u = String(u || "").trim().replace(/\/+$/, "");
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  }
  function myBits() {
    return myCode().split(".")[2];
  }
  function inviteLink() {
    return state.sync ? state.sync.server + "/join#" + state.sync.token : "";
  }

  async function api(method, path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(state.sync.server + path, {
        method, signal: ctl.signal,
        headers: { "Content-Type": "application/json", "X-Member-Key": state.sync.key },
        body: body ? JSON.stringify(body) : undefined
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(json.error || "Server error " + r.status), { status: r.status });
      return json;
    } catch (e) {
      if (!e.status) throw Object.assign(new Error("No connection"), { offline: true });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // called whenever state changes: flags an upload if your name/picks differ from what the server has
  function markDirty() {
    if (!state.sync) return;
    const sig = state.me + "|" + myBits();
    if (sig !== state.sync.sentSig) { state.sync.dirty = true; syncSoon(); }
  }
  function syncSoon() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1500);
  }

  async function syncNow(manual) {
    const s = state.sync;
    if (!s || syncing) return;
    syncing = true;
    s.lastTry = Date.now();
    try {
      let view;
      if (state.meetDirty) { try { await pushMeet(); } catch (e) { if (e.offline) throw e; state.meetDirty = false; } }
      if (s.dirty && state.me) {
        const sig = state.me + "|" + myBits();
        view = await api("PUT", `/api/crews/${s.token}/members/${s.memberId}`, { name: state.me, bits: myBits() });
        s.sentSig = sig;
        s.dirty = (state.me + "|" + myBits()) !== sig; // changed again while uploading
      } else {
        view = await api("GET", `/api/crews/${s.token}?me=${s.memberId}`);
      }
      applyCrew(view);
      s.lastOk = Date.now();
      s.lastErr = "";
      if (manual) toast("Synced ✓");
    } catch (e) {
      s.lastErr = e.message;
      if (manual) toast(e.offline ? "No signal. Will sync when you're back online" : e.message);
    } finally {
      syncing = false;
      save();
      if (state.view === "crew" || state.view === "schedule" || state.view === "plan") renderAll();
      if (s.dirty && !s.lastErr) syncSoon();
    }
  }

  function applyCrew(view) {
    const s = state.sync;
    s.crewName = view.name || s.crewName;
    const skew = Date.now() - (view.now || Date.now()); // server clock → phone clock
    const seenIds = new Set();
    (view.members || []).forEach((m) => {
      if (m.id === s.memberId) return;
      const picks = decodeBits(m.bits);
      if (!picks) return;
      const id = "live-" + m.id;
      seenIds.add(id);
      let f = friendById(id);
      if (!f) {
        // replace a code-imported friend with the same name by their live version
        const twin = state.friends.find((x) => !x.live && x.name.toLowerCase() === m.name.toLowerCase());
        const used = state.friends.map((x) => x.color);
        f = { id, live: true, hidden: twin ? twin.hidden : false,
          color: twin ? twin.color : CREW_COLORS.find((c) => !used.includes(c)) || CREW_COLORS[state.friends.length % CREW_COLORS.length] };
        if (twin) state.friends = state.friends.filter((x) => x !== twin);
        state.friends.push(f);
      }
      f.name = cleanName(m.name);
      f.picks = picks;
      f.updated = m.updated + skew;
      f.seen = m.seen + skew;
      f.loc = m.loc ? { lat: m.loc.lat, lon: m.loc.lon, acc: m.loc.acc, t: m.loc.t + skew } : null;
    });
    if (!state.meetDirty) state.meet = view.meet ? Object.assign({}, view.meet, { t: view.meet.t + skew }) : null;
    state.friends = state.friends.filter((f) => !f.live || seenIds.has(f.id));
    planCache = {};
  }
  function cleanName(n) {
    return String(n || "").trim().slice(0, 24) || "Friend";
  }

  async function createCrew() {
    const server = normServer($("#server-url") ? $("#server-url").value : state.lastServer);
    if (!state.me) { toast("Add your name first"); return; }
    if (!server) { toast("Enter your sync server address"); return; }
    state.lastServer = server;
    try {
      const ctl = new AbortController();
      setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(server + "/api/crews", { method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: state.me + "'s crew" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Server error " + r.status);
      await joinCrew(server, j.token, true);
      toast("Live crew created. Now invite your friends");
    } catch (e) {
      toast(e.name === "AbortError" || e instanceof TypeError ? "Couldn't reach " + server : e.message);
    }
  }

  async function joinCrew(server, token, quiet) {
    if (state.sync && state.sync.token === token) { if (!quiet) toast("You're already in this crew"); setView("crew"); return; }
    if (state.sync && !confirm("You're already in a live crew. Leave it and join this one?")) return;
    if (state.sync) await leaveCrew(true);
    state.lastServer = server;
    state.sync = { server, token, memberId: randId(9), key: randId(18), dirty: true, sentSig: "", lastOk: 0, lastErr: "", crewName: "" };
    save();
    setView("crew");
    if (!quiet) toast(state.me ? "Joining crew…" : "Joined! Add your name so friends can see you");
    await syncNow();
  }

  async function leaveCrew(quiet) {
    const s = state.sync;
    if (!s) return;
    try { await api("DELETE", `/api/crews/${s.token}/members/${s.memberId}`); } catch (e) { /* offline: slot just goes stale */ }
    if (window.Native && window.Native.stopSharing) window.Native.stopSharing();
    state.sync = null;
    state.meetDirty = false;
    state.friends = state.friends.filter((f) => !f.live);
    planCache = {};
    save();
    if (!quiet) { toast("Left the live crew"); renderAll(); }
  }

  function shareInvite() {
    const link = inviteLink();
    const txt = `Join my EDC Orlando crew 🎶 Our plans sync live in EDC Planner.\nTap to join: ${link}`;
    if (window.Native) window.Native.share(txt);
    else if (navigator.share) navigator.share({ text: txt });
    else copyText(txt);
  }

  // returns true if the text held an invite link
  function handleInvite(text) {
    let m = String(text).match(INVITE_APP_RE);
    let server, token;
    if (m) { server = normServer(decodeURIComponent(m[1])); token = m[2]; }
    else if ((m = String(text).match(INVITE_WEB_RE))) { server = normServer(m[1]); token = m[2]; }
    if (!server) return false;
    joinCrew(server, token);
    return true;
  }

  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function syncCardHtml() {
    const s = state.sync;
    if (!s) {
      return `<div class="crew-card">
        <label>Live sync</label>
        <p class="small" style="margin-top:0">Friends' plans update by themselves through your own sync server. Everything still works offline.</p>
        <div class="row"><input id="server-url" placeholder="edc.yourdomain.com" value="${esc((state.lastServer || "").replace(/^https:\/\//, ""))}" autocomplete="off" spellcheck="false" inputmode="url">
        <button class="chip-btn" id="create-crew">Create</button></div>
        <p class="small">Joining a friend's crew? Open their invite link, or copy it and tap Paste below.</p></div>`;
    }
    let dot = "ok", status;
    if (s.lastErr && s.lastErr !== "No connection") { dot = "bad"; status = esc(s.lastErr); }
    else if (s.lastErr) { dot = "off"; status = `Offline · showing plans from ${s.lastOk ? ago(s.lastOk) : "before"} · will sync when you have signal`; }
    else if (s.lastOk) status = `Live · synced ${ago(s.lastOk)}`;
    else { dot = "off"; status = "Connecting…"; }
    if (s.dirty) status += !state.me ? " · add your name to share your picks" : " · your changes are waiting to upload";
    return `<div class="crew-card">
      <label>Live crew${s.crewName ? " · " + esc(s.crewName) : ""}</label>
      <div class="sync-status"><i class="sdot ${dot}"></i><span>${status}</span></div>
      <div class="row gap"><button class="big-btn" id="invite">Invite friends</button></div>
      <div class="row gap"><button class="chip-btn grow" id="sync-now">↻ Sync now</button><button class="chip-btn grow dim" id="leave-crew">Leave crew</button></div>
    </div>`;
  }

  // ---------- find my crew (live locations) ----------
  const STALE_MIN = 15;
  let findTimer = null, findPoll = 0, webFix = null, webWatch = null;

  function myFix() {
    if (window.EDC_FAKE_FIX) return window.EDC_FAKE_FIX; // test hook
    if (window.Native) {
      try { const s = window.Native.myLocation(); return s ? JSON.parse(s) : null; } catch (e) { return null; }
    }
    return webFix;
  }
  function myHeading() {
    if (window.EDC_FAKE_HEADING != null) return window.EDC_FAKE_HEADING;
    const h = window.Native ? window.Native.heading() : -1;
    return h >= 0 ? h : -1;
  }
  function locAllowed() {
    return window.Native ? window.Native.locationAllowed() : true;
  }
  // metres east/north of a reference point
  function toMeters(lat, lon, lat0, lon0) {
    return { e: (lon - lon0) * Math.cos(lat0 * Math.PI / 180) * 111320, n: (lat - lat0) * 110540 };
  }
  function distBearing(a, b) {
    const m = toMeters(b.lat, b.lon, a.lat, a.lon);
    return { d: Math.hypot(m.e, m.n), brg: (Math.atan2(m.e, m.n) * 180 / Math.PI + 360) % 360 };
  }
  function cardinal(brg) {
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(brg / 45) % 8];
  }
  function fmtDist(d) {
    return d < 1000 ? Math.round(d / 5) * 5 + " m" : (d / 1000).toFixed(1) + " km";
  }
  function untilTwoAm() {
    const d = new Date();
    const t = new Date(d);
    t.setHours(2, 0, 0, 0);
    if (t <= d) t.setDate(t.getDate() + 1);
    return t.getTime();
  }
  function sharingInfo() {
    if (!window.Native) return state.webSharing || null;
    try { const s = window.Native.sharing(); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  // ----- map calibration: two "I'm here" taps link the drawn map to GPS -----
  function mapTransform() {
    const c = state.calib || [];
    if (c.length < 2) return null;
    const p1 = c[c.length - 2], p2 = c[c.length - 1];
    const lat0 = p1.lat, lon0 = p1.lon;
    const cm = (p) => { const m = toMeters(p.lat, p.lon, lat0, lon0); return [m.e, -m.n]; };
    const cp = (p) => [p.x * 1000, p.y * 1250];
    const m1 = cm(p1), m2 = cm(p2), q1 = cp(p1), q2 = cp(p2);
    // complex a = (q2-q1)/(m2-m1)
    const dm = [m2[0] - m1[0], m2[1] - m1[1]], dq = [q2[0] - q1[0], q2[1] - q1[1]];
    const den = dm[0] * dm[0] + dm[1] * dm[1];
    if (den < 400) return null;
    const a = [(dq[0] * dm[0] + dq[1] * dm[1]) / den, (dq[1] * dm[0] - dq[0] * dm[1]) / den];
    const b = [q1[0] - (a[0] * m1[0] - a[1] * m1[1]), q1[1] - (a[0] * m1[1] + a[1] * m1[0])];
    return {
      metersPerPx: 1 / Math.hypot(a[0], a[1]),
      toMap(lat, lon) {
        const m = cm({ lat, lon });
        return { x: (a[0] * m[0] - a[1] * m[1] + b[0]) / 1000, y: (a[0] * m[1] + a[1] * m[0] + b[1]) / 1250 };
      }
    };
  }
  function nearStage(lat, lon) {
    const T = mapTransform();
    if (!T) return "";
    const p = T.toMap(lat, lon);
    let best = null;
    D.stages.forEach((st) => {
      const [x, y] = D.mapPins[st.id];
      const dm = Math.hypot((p.x - x) * 1000, (p.y - y) * 1250) * T.metersPerPx;
      if (!best || dm < best.d) best = { d: dm, st };
    });
    return best && best.d < 90 ? "near " + best.st.name : "";
  }

  function crewLocs() {
    return visibleFriends().filter((f) => f.live && f.loc && Date.now() - f.loc.t < 2 * 3600000);
  }

  function renderFind() {
    const el = $("#find");
    const fix = myFix();
    const hd = myHeading();
    const share = sharingInfo();
    let html = `<div class="find-head"><h2>📡 Find my crew</h2><button class="chip-btn" id="find-close">Done</button></div>`;

    if (!state.sync) {
      el.innerHTML = html + `<div class="empty"><p>Finding friends uses your <b>live crew</b> server. Set one up in the Crew tab first. The meet-up spot on the Map works without it.</p>
        <button class="big-btn" data-go="crew">Go to Crew</button></div>`;
      return;
    }
    if (!locAllowed()) {
      el.innerHTML = html + `<div class="crew-card"><p class="small" style="margin-top:0">To show where your friends are compared to you, the app needs your location. It's only sent to your crew if you turn on sharing below.</p>
        <button class="big-btn" id="loc-allow">Allow location</button></div>`;
      return;
    }

    // share toggle
    const on = !!share;
    let st = "Off. Your crew can't see you.";
    if (on) {
      const s = String(share.status || "");
      const sent = s.startsWith("ok:") ? "last sent " + ago(Number(s.split(":")[1])) : s.startsWith("err:") ? "no signal, retrying" : "waiting for GPS";
      st = `On until ${new Date(share.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${sent}`;
    }
    html += `<div class="crew-card"><label>Share my location with the crew</label>
      <div class="seg" id="share-seg">
        <button data-share="0" class="${!on ? "on" : ""}">Off</button>
        <button data-share="1h">1 hour</button>
        <button data-share="2am">Until 2 AM</button></div>
      <div class="sync-status" style="margin-top:8px"><i class="sdot ${on ? "ok" : "off"}"></i><span>${st}</span></div></div>`;

    if (state.meet) html += meetCardHtml(fix);

    // radar
    const people = crewLocs().map((f) => {
      const db = fix ? distBearing(fix, f.loc) : null;
      return { f, db, stale: Date.now() - f.loc.t > STALE_MIN * 60000 };
    }).sort((a, b) => (a.db ? a.db.d : 1e9) - (b.db ? b.db.d : 1e9));
    const far = Math.max(60, ...people.filter((p) => p.db && !p.stale).map((p) => p.db.d));
    const steps = [50, 100, 200, 300, 500, 1000, 2000, 5000];
    const range = steps.find((s) => s >= far * 1.1) || 5000;
    const rot = hd >= 0 ? hd : 0;
    let svg = `<svg viewBox="0 0 300 300"><defs><radialGradient id="sweep" cx="0" cy="0" r="1"><stop offset="0" stop-color="#c6ff3d" stop-opacity=".25"/><stop offset="1" stop-color="#c6ff3d" stop-opacity="0"/></radialGradient></defs>
      <circle class="radar-bg" cx="150" cy="150" r="140"/>`;
    [0.33, 0.66].forEach((k) => (svg += `<circle class="radar-ring" cx="150" cy="150" r="${140 * k}"/><text class="radar-lbl" x="153" y="${150 - 140 * k + 10}">${fmtDist(range * k)}</text>`));
    svg += `<text class="radar-lbl" x="153" y="20">${fmtDist(range)}</text>`;
    svg += `<path class="radar-sweep" d="M150,150 L150,10 A140,140 0 0,1 249,51 Z"/>`;
    // north marker rotates with the phone
    const nx = 150 + 128 * Math.sin(-rot * Math.PI / 180), ny = 150 - 128 * Math.cos(-rot * Math.PI / 180);
    svg += `<text class="radar-n" x="${nx}" y="${ny}" text-anchor="middle" dominant-baseline="central">N</text>`;
    people.forEach((p) => {
      if (!p.db) return;
      const r = Math.min(1, p.db.d / range) * 140;
      const a = (p.db.brg - rot) * Math.PI / 180;
      const x = 150 + r * Math.sin(a), y = 150 - r * Math.cos(a);
      svg += `<g class="radar-dot ${p.stale ? "stale" : ""}"><circle cx="${x}" cy="${y}" r="11" fill="${p.f.color}" stroke="#10061c" stroke-width="2"/><text x="${x}" y="${y}">${initial(p.f.name)}</text></g>`;
    });
    svg += `<circle class="radar-me" cx="150" cy="150" r="7"/><path d="M150,136 l6,10 h-12z" fill="#c6ff3d"/></svg>`;
    let note = !fix ? "Waiting for GPS…" : hd < 0 ? "North is up (no compass on this phone)" : "Turns with your phone. Straight ahead is up.";
    if (fix && fix.acc > 50) note += ` · GPS ±${Math.round(fix.acc)} m`;
    html += `<div class="radar-wrap">${svg}</div><div class="radar-note">${note}</div>`;

    // list
    html += `<div class="flist">`;
    if (!people.length) {
      html += `<p class="small" style="text-align:center">Nobody in your crew is sharing their location right now.</p>`;
    }
    people.forEach((p) => {
      const near = nearStage(p.f.loc.lat, p.f.loc.lon);
      const arrowRot = p.db ? p.db.brg - rot : 0;
      html += `<div class="fl ${p.stale ? "stale" : ""}" style="--c:${p.f.color}">${avatar(p.f, true)}
        <div class="fi"><b>${esc(p.f.name)}</b><span>${p.stale ? "last seen " : "updated "}${ago(p.f.loc.t)}${p.f.loc.acc ? " · ±" + p.f.loc.acc + " m" : ""}${near ? " · " + near : ""}</span></div>
        ${p.db ? `<svg class="arrow" viewBox="0 0 24 24" style="transform:rotate(${arrowRot}deg)"><path d="M12 2 L19 20 L12 16 L5 20 Z" fill="${p.f.color}"/></svg>
        <div class="dist">${fmtDist(p.db.d)}<small>${cardinal(p.db.brg)}</small></div>` : ""}</div>`;
    });
    // members not sharing
    visibleFriends().filter((f) => f.live && !people.some((p) => p.f === f)).forEach((f) => {
      html += `<div class="fl stale" style="--c:${f.color}">${avatar(f, true)}<div class="fi"><b>${esc(f.name)}</b><span>Not sharing location</span></div></div>`;
    });
    html += `</div><p class="small">Friends' positions update when their phone and yours have signal. Arrows show the straight-line direction, so walkways and crowds may make the trip longer.</p>`;
    el.innerHTML = html;
  }

  function meetCardHtml(fix) {
    const m = state.meet;
    let extra = "";
    const T = mapTransform();
    if (T && fix) {
      // distance on the calibrated map between you and the pin
      const p0 = T.toMap(fix.lat, fix.lon);
      const dx = (m.x - p0.x) * 1000, dy = (m.y - p0.y) * 1250;
      const d = Math.hypot(dx, dy) * T.metersPerPx;
      extra = ` · about ${fmtDist(d)} from you`;
    }
    return `<div class="meet-card"><span style="font-size:22px">🚩</span><div class="grow">Meet-up: <b>${esc(m.label)}</b>${extra}<br>
      <span style="color:var(--dim);font-size:12px">set by ${esc(m.by || "you")} ${m.t ? ago(m.t) : ""}${state.meetDirty ? " · not shared yet (no signal)" : ""}</span></div>
      <button class="chip-btn" data-showmeet="1">Map</button></div>`;
  }

  function setSharing(mode) {
    if (mode === "0") {
      if (window.Native) window.Native.stopSharing(); else state.webSharing = null;
      toast("Location sharing off");
    } else {
      const until = mode === "1h" ? Date.now() + 3600000 : untilTwoAm();
      const cfg = { server: state.sync.server, token: state.sync.token, memberId: state.sync.memberId, key: state.sync.key, until };
      if (state.sync.dirty) syncNow(); // make sure we exist on the server first
      if (window.Native) {
        if (window.Native.notificationsAllowed && !window.Native.notificationsAllowed()) window.Native.requestNotifications();
        if (!window.Native.startSharing(JSON.stringify(cfg))) { toast("Allow location first"); return; }
      } else {
        state.webSharing = { until, status: "" };
      }
      toast("Your crew can now see you");
    }
    setTimeout(renderFind, 400);
  }

  function startFind() {
    if (window.Native) window.Native.watch(true);
    else if (navigator.geolocation && !webWatch) {
      webWatch = navigator.geolocation.watchPosition((p) => { webFix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp }; }, () => {}, { enableHighAccuracy: true });
    }
    clearInterval(findTimer);
    findPoll = 0;
    findTimer = setInterval(() => {
      if (state.view !== "find" || document.hidden) return;
      renderFind();
      if (++findPoll % 15 === 0) syncNow(); // refresh friends' positions every ~15 s
    }, 1000);
    syncNow();
  }
  function stopFind() {
    clearInterval(findTimer);
    findTimer = null;
    if (window.Native) window.Native.watch(false);
    else if (webWatch != null) { navigator.geolocation.clearWatch(webWatch); webWatch = null; }
  }
  window.onLocationPermission = function (ok) {
    if (ok) { if (state.view === "find") startFind(); if (state.view === "map") renderMap(); }
    else toast("Location permission denied. You can allow it in Settings → Apps");
    renderAll();
  };

  // ----- map modes: calibrate ("I'm here") or place the meet-up spot -----
  let mapMode = null;
  function setMapMode(m) {
    mapMode = m;
    const bar = $("#map-mode");
    $("#map-box").classList.toggle("picking", !!m);
    if (!m) { bar.hidden = true; return; }
    if (m === "calib" && window.Native) window.Native.watch(true);
    bar.hidden = false;
    bar.innerHTML = (m === "calib"
      ? "<span>Tap the exact spot on the map where you're standing now.</span>"
      : "<span>Tap the meet-up spot on the map.</span>") + `<button id="map-mode-cancel">Cancel</button>`;
  }
  function mapTap(e) {
    const r = $("#map-inner").getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (mapMode === "calib") {
      const fix = myFix();
      if (!fix) { toast("No GPS fix yet. Try again in a moment"); return; }
      if (fix.acc > 60) { toast(`GPS is too rough right now (±${Math.round(fix.acc)} m). Try again in the open`); return; }
      if (Date.now() - fix.t > 180000 && !window.EDC_FAKE_FIX) { toast("GPS fix is old. Wait a moment and try again"); return; }
      state.calib = (state.calib || []).concat([{ x, y, lat: fix.lat, lon: fix.lon }]).slice(-2);
      const T = mapTransform();
      if (state.calib.length < 2) toast("Got it. Now walk to another spot at least 100 m away and tap “I'm here” again");
      else if (!T) { state.calib = state.calib.slice(-1); toast("Those spots were too close together. Try one further away"); }
      else if (T.metersPerPx * 1000 < 150 || T.metersPerPx * 1000 > 5000) { state.calib = state.calib.slice(-1); toast("That didn't line up. Check the spot you tapped and try again"); }
      else toast("Map calibrated ✓ Your crew now shows up on the map");
    } else if (mapMode === "meet") {
      const label = (prompt("Name the meet-up spot", "Ferris wheel") || "").trim().slice(0, 40);
      if (!label) { setMapMode(null); return; }
      state.meet = { x, y, label, by: state.me || "You", t: Date.now() };
      state.meetDirty = !!state.sync;
      if (state.sync) syncNow(); else toast("Meet-up spot saved. Join a live crew to share it");
    }
    setMapMode(null);
    save();
    renderMap();
  }

  async function pushMeet() {
    const s = state.sync;
    if (!s || !state.meetDirty) return;
    const path = `/api/crews/${s.token}/members/${s.memberId}/meet`;
    const view = state.meet
      ? await api("PUT", path, { x: state.meet.x, y: state.meet.y, label: state.meet.label })
      : await api("DELETE", path);
    state.meetDirty = false;
    return view;
  }

  function mapCrewHtml() {
    let html = "";
    if (state.meet) {
      html += `<div class="meetpin" style="left:${state.meet.x * 100}%;top:${state.meet.y * 100}%"><div class="flag">🚩</div><div class="lbl2">${esc(state.meet.label)}</div></div>`;
    }
    const T = mapTransform();
    if (!T) return html;
    crewLocs().forEach((f) => {
      const p = T.toMap(f.loc.lat, f.loc.lon);
      if (p.x < -0.05 || p.x > 1.05 || p.y < -0.05 || p.y > 1.05) return;
      const stale = Date.now() - f.loc.t > STALE_MIN * 60000;
      html += `<div class="cdot ${stale ? "stale" : ""}" style="left:${p.x * 100}%;top:${p.y * 100}%;--c:${f.color}">${initial(f.name)}</div>`;
    });
    const fix = locAllowed() ? myFix() : null;
    if (fix && Date.now() - fix.t < 600000) {
      const p = T.toMap(fix.lat, fix.lon);
      html += `<div class="cdot me" style="left:${p.x * 100}%;top:${p.y * 100}%"></div>`;
    }
    return html;
  }

  function renderCrew() {
    // don't redraw under someone typing (the 60s refresh and sync would wipe the field)
    const a = document.activeElement;
    if (a && a.tagName === "INPUT" && a.closest("#crew")) return;
    const day = DAY[state.day];
    const el = $("#crew");
    const nowMin = nowMinFor(day);
    let html = "";

    // you + your code
    html += `<div class="crew-card">
      <label>Your name</label>
      <div class="row"><input id="me-name" maxlength="24" placeholder="So friends know it's you" value="${esc(state.me)}">
      <button class="chip-btn" id="save-name">Save</button></div>
      ${state.sync ? "" : `<div class="row gap">
        <button class="big-btn" id="share-code">Share my crew code</button>
      </div>
      <p class="small">No server? Send your code to friends instead. Their codes go in below. If you change your picks, share your code again.</p>`}
    </div>`;

    html += syncCardHtml();
    if (state.sync) html += `<button class="big-btn" id="find-open" style="margin-bottom:12px">📡 Find my crew</button>`;
    if (state.meet) html += meetCardHtml(locAllowed() ? myFix() : null);

    // add friend
    html += `<div class="crew-card">
      <label>Add a friend${state.sync ? " (not in your live crew)" : ""}</label>
      <button class="big-btn ghost" id="paste-code">📋 Paste code or invite link</button>
      <div class="row"><input id="code-box" placeholder="…or type it here (EDC1.…)" autocomplete="off" spellcheck="false">
      <button class="chip-btn" id="add-code">Add</button></div>
      <p class="small">In WhatsApp or Messages you can also long-press their message, tap Share and pick <b>EDC Planner</b>.</p>
    </div>`;

    if (!state.friends.length) {
      html += `<div class="empty"><div style="font-size:40px">👯</div><p>No friends yet. Once you add some, you'll see which sets you share, when you'll be at the same set, and where everyone is.</p></div>`;
      el.innerHTML = html;
      return;
    }

    // friend list
    html += `<h3 class="sec">Your crew</h3><div class="friends">`;
    state.friends.forEach((f) => {
      const theirs = BY_DAY[day.id].filter((s) => f.picks[s.id]);
      const shared = theirs.filter((s) => state.picks[s.id]).length;
      html += `<div class="friend ${f.hidden ? "off" : ""}" style="--c:${f.color}">
        ${avatar(f, true)}
        <button class="finfo" data-friend="${f.id}"><b>${esc(f.name)}</b>
          <span>${theirs.length} picks on ${day.label} · ${shared} shared with you</span>
          <span class="fsrc">${f.live ? `<i class="sdot ok"></i>live · active ${ago(f.seen || f.updated)}` : `code from ${f.updated ? ago(f.updated) : "earlier"}`}</span></button>
        <button class="fbtn" data-hide="${f.id}" aria-label="Show or hide">${f.hidden ? "◌" : "◉"}</button>
        ${f.live ? "" : `<button class="fbtn" data-unfriend="${f.id}" aria-label="Remove">✕</button>`}</div>`;
    });
    html += `</div><p class="small">Tap a friend to see their plan. ◉ / ◌ shows or hides them on the schedule and in the overlaps below.</p>`;

    const vis = visibleFriends();
    if (!vis.length) { el.innerHTML = html; return; }
    const me = meAsPerson();

    // live: where is everyone
    if (nowMin >= START_MIN - 60 && nowMin <= END_MIN) {
      html += `<h3 class="sec">Where everyone is · ${fmt(Math.max(nowMin, START_MIN), true)}</h3>`;
      [me].concat(vis).forEach((p) => {
        const route = planFor(day.id, p.me ? undefined : p.id).route;
        const cur = nodeAt(route, nowMin);
        const nxt = route.find((n) => n.from > nowMin);
        const txt = cur ? `<b>${esc(cur.set.name)}</b> @ ${STAGE[cur.set.stage].name} until ${fmt(cur.to)}`
          : nxt ? `Heading to <b>${esc(nxt.set.name)}</b> @ ${STAGE[nxt.set.stage].name} for ${fmt(nxt.from)}`
          : "Nothing else planned";
        html += `<div class="where">${avatar(p)}<span><b>${esc(p.me ? "You" : p.name)}</b>: ${txt}</span></div>`;
      });
    }

    // hang-out windows
    const segs = hangouts(day.id);
    html += `<h3 class="sec">Together on ${day.name}</h3>`;
    if (segs.length) {
      segs.forEach((g) => {
        const st = STAGE[g.set.stage];
        html += `<div class="hang" style="--c:${st.color}"><div class="ht">${fmt(g.from)}–${fmt(g.to, true)}</div>
          <div class="hb"><b>${esc(g.set.name)}</b> <span>@ ${st.name}</span></div>
          <div class="avs">${g.people.map((p) => avatar(p)).join("")}</div></div>`;
      });
    } else {
      html += `<p class="small">Your plan doesn't put you at the same set as anyone today. Check the crew favorites below for sets to add.</p>`;
    }

    // crew favorites
    const rows = BY_DAY[day.id].map((s) => {
      const who = [me].concat(vis).filter((p) => p.picks[s.id]);
      return { s, who };
    }).filter((r) => r.who.length >= 2 || (r.who.length >= 1 && !r.who[0].me))
      .sort((a, b) => b.who.length - a.who.length || a.s.start - b.s.start);
    html += `<h3 class="sec">Crew favorites</h3>`;
    if (!rows.length) html += `<p class="small">None of your crew has picked anything on ${day.label} yet.</p>`;
    rows.forEach((r) => {
      const st = STAGE[r.s.stage];
      const p = state.picks[r.s.id] || 0;
      html += `<div class="res" data-set="${r.s.id}" style="--c:${st.color}">
        <div class="info"><div class="nm">${esc(r.s.name)}</div>
        <div class="meta">${st.name} · ${fmt(r.s.start)}–${fmt(r.s.end, true)}</div>
        <div class="avs">${r.who.map((x) => avatar(x)).join("")}<span class="cnt">${r.who.length === vis.length + 1 ? "Everyone!" : r.who.length + " of " + (vis.length + 1)}</span></div></div>
        <div class="mk ${p === 2 ? "must" : p === 1 ? "want" : ""}">${p === 2 ? "♥" : p === 1 ? "★" : "☆"}</div></div>`;
    });
    el.innerHTML = html;
  }

  let sheetFriend = null;
  function openFriend(id) {
    const f = friendById(id);
    if (!f) return;
    sheetFriend = id;
    const day = DAY[state.day];
    const plan = planFor(day.id, f.id);
    let html = `<h2>${avatar(f, true)} ${esc(f.name)} · ${day.name}</h2>`;
    if (!plan.route.length) html += `<p class="small">${esc(f.name)} hasn't picked anything for ${day.label}.</p>`;
    plan.route.forEach((n) => {
      const st = STAGE[n.set.stage];
      const mine = state.picks[n.set.id] || 0;
      html += `<div class="res" data-set="${n.set.id}" style="--c:${st.color}">
        <div class="info"><div class="nm">${n.prio === 2 ? "♥ " : ""}${esc(n.set.name)}</div>
        <div class="meta">${fmt(n.from)}–${fmt(n.to, true)} · ${st.name}</div></div>
        <div class="mk ${mine === 2 ? "must" : mine === 1 ? "want" : ""}">${mine === 2 ? "♥" : mine === 1 ? "★" : "☆"}</div></div>`;
    });
    const updated = f.updated ? new Date(f.updated).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    html += f.live
      ? `<p class="small">Tap a set to add it to your own plan. Live: ${esc(f.name)} last changed picks ${ago(f.updated)}, last online ${ago(f.seen || f.updated)}.</p>`
      : `<p class="small">Tap a set to add it to your own plan. Code received ${updated}. Ask ${esc(f.name)} to share again if they change plans.</p>`;
    openSheet(html);
  }

  // ---------- view switching ----------
  const mapZoom = makeZoom($("#map-box"), $("#map-inner"));
  makeZoom($("#poster-box"), $("#poster-inner"));

  function setView(v) {
    if (state.view === "find" && v !== "find") stopFind();
    if (v !== "map" && mapMode) setMapMode(null);
    state.view = v;
    $$(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + v));
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === (v === "find" ? "crew" : v)));
    $("#days").hidden = v === "find";
    if (v === "find") startFind();
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
    if (state.view === "crew") renderCrew();
    if (state.view === "find") renderFind();
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
    if (mapMode && t.closest("#map-inner")) { mapTap(e); return; }
    if (t.closest("#map-mode-cancel")) { setMapMode(null); return; }
    if (t.closest("#find-open") || t.closest("#find-open-map")) { setView("find"); return; }
    if (t.closest("#find-close")) { setView("crew"); return; }
    if (t.closest("#loc-allow")) { window.Native ? window.Native.requestLocation() : renderFind(); return; }
    if ((el = t.closest("[data-share]"))) { setSharing(el.dataset.share); return; }
    if (t.closest("#calib-start")) {
      if (!locAllowed()) { window.Native.requestLocation(); return; }
      setMapMode("calib"); return;
    }
    if (t.closest("#meet-start")) { setMapMode("meet"); return; }
    if (t.closest("#calib-reset")) { e.preventDefault(); state.calib = []; save(); renderMap(); toast("Map calibration cleared"); return; }
    if (t.closest("#meet-clear")) {
      e.preventDefault();
      if (confirm("Clear the meet-up spot for everyone?")) { state.meet = null; state.meetDirty = !!state.sync; save(); renderMap(); if (state.sync) syncNow(); }
      return;
    }
    if (t.closest("[data-showmeet]")) { mapRoute = "none"; setView("map"); return; }
    const ae = document.activeElement;
    if (t.closest("button") && ae && ae.tagName === "INPUT") ae.blur();
    if ((el = t.closest("#days button"))) {
      state.day = el.dataset.day; mapRoute = null; save(); renderAll();
      if (state.view === "schedule") $("#view-schedule").scrollTop = 0;
      return;
    }
    if ((el = t.closest("#tabs button"))) { setView(el.dataset.view); return; }
    if ((el = t.closest("[data-friend]"))) { openFriend(el.dataset.friend); return; }
    if ((el = t.closest("[data-set]"))) {
      cyclePick(el.dataset.set);
      return;
    }
    if ((el = t.closest("[data-hide]"))) { const f = friendById(el.dataset.hide); f.hidden = !f.hidden; changed(); return; }
    if ((el = t.closest("[data-unfriend]"))) {
      const f = friendById(el.dataset.unfriend);
      if (confirm("Remove " + f.name + " from your crew?")) { state.friends = state.friends.filter((x) => x !== f); changed(); toast("Removed " + f.name); }
      return;
    }
    if (t.closest("#save-name")) {
      state.me = $("#me-name").value.trim().slice(0, 24); markDirty(); save(); toast(state.me ? "Hi " + state.me + "!" : "Name cleared"); renderCrew(); return;
    }
    if (t.closest("#share-code")) {
      const v = $("#me-name").value.trim().slice(0, 24);
      if (v !== state.me) { state.me = v; markDirty(); save(); }
      shareMyCode(); return;
    }
    if (t.closest("#paste-code")) { pasteCrew(); return; }
    if (t.closest("#create-crew")) { createCrew(); return; }
    if (t.closest("#invite")) { shareInvite(); return; }
    if (t.closest("#sync-now")) { syncNow(true); return; }
    if (t.closest("#leave-crew")) { if (confirm("Leave the live crew? Their plans will disappear from your app.")) leaveCrew(); return; }
    if (t.closest("#add-code")) { if (importCrewText($("#code-box").value)) $("#code-box").value = ""; return; }
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

  document.addEventListener("change", (e) => {
    if (e.target.id === "me-name") { state.me = e.target.value.trim().slice(0, 24); markDirty(); save(); }
    if (e.target.id === "server-url") { state.lastServer = normServer(e.target.value); save(); }
  });
  $("#search").addEventListener("input", () => { renderSearch(); $("#view-schedule").scrollTop = 0; });

  window.onBack = function () {
    if (!$("#sheet").hidden) { closeSheet(); return true; }
    if (!$("#searchbar").hidden) { closeSearch(); return true; }
    if (mapMode) { setMapMode(null); return true; }
    if (state.view === "find") { setView("crew"); return true; }
    if (state.view !== "schedule") { setView("schedule"); return true; }
    return false;
  };
  function checkIncoming() {
    if (!window.Native || !window.Native.takeIncoming) return;
    const t = window.Native.takeIncoming();
    if (t) { importCrewText(t); setView("crew"); }
  }
  window.onAppResume = function () { planCache = {}; renderAll(); checkIncoming(); syncNow(); };
  window.addEventListener("online", () => syncNow());
  setInterval(() => { if (!document.hidden) syncNow(); }, 60000);

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
  checkIncoming();
  syncNow();
  window.EDC_CREW = { encodeCode, importCrewText };
})();

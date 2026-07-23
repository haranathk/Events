/* Event Tracker - Web App
   A faithful web/PWA recreation of the SwiftUI Event Tracker app.
   Data persists in IndexedDB on this device/browser, saved automatically
   after every add/edit/delete — no Save button, no data loss on exit. */

(function () {
  "use strict";

  // ---------- Storage (IndexedDB) ----------
  const DB_NAME = "EventTrackerDB";
  const DB_VERSION = 1;
  const STORE_NAME = "events";
  const LEGACY_STORAGE_KEY = "eventTrackerEvents"; // old localStorage key, used once for migration only
  const DARK_KEY = "eventTrackerDarkMode";

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  const dbPromise = openDB();

  function loadEventsFromDB() {
    return dbPromise.then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    })).catch((e) => { console.error("Failed to load events from IndexedDB", e); return []; });
  }

  // Persists the full current in-memory events list. Called immediately after
  // every add/edit/delete — this IS the auto-save, there is no separate Save step.
  function saveEvents() {
    return dbPromise.then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      state.events.forEach((ev) => store.put(ev));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    })).catch((e) => console.error("Failed to save events to IndexedDB", e));
  }

  // One-time migration: earlier versions of this app stored events in
  // localStorage. If IndexedDB is empty but old localStorage data exists,
  // pull it in automatically so nobody's existing events disappear.
  function loadLegacyLocalStorageEvents() {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw) || [];
    } catch (e) {
      return [];
    }
  }

  // eventType shapes: {kind:'birthday'} | {kind:'anniversary'} | {kind:'custom', name, icon}

  const state = {
    events: [], // populated asynchronously from IndexedDB during init, see bottom of file
    activeTab: "home",
    home: { showBirthdays: true, showAnniversaries: true, showCustom: true, searching: false, search: "" },
    cal: { showBirthdays: true, showAnniversaries: true, showCustom: true, month: new Date(), selected: new Date() },
    tl: { showBirthdays: true, showAnniversaries: true, showCustom: true },
    editingEventId: null, // null = adding
  };

  // ---------- Date helpers ----------
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function toISO(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${day}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }

  function daysUntilNextOccurrence(dateISO) {
    const date = parseISO(dateISO);
    const today = startOfDay(new Date());
    const year = today.getFullYear();
    let next = new Date(year, date.getMonth(), date.getDate());
    if (next < today) next = new Date(year + 1, date.getMonth(), date.getDate());
    return daysBetween(today, next);
  }

  function yearsSince(dateISO) {
    const date = parseISO(dateISO);
    const today = new Date();
    let years = today.getFullYear() - date.getFullYear();
    const beforeAnniv = (today.getMonth() < date.getMonth()) || (today.getMonth() === date.getMonth() && today.getDate() < date.getDate());
    if (beforeAnniv) years--;
    return Math.max(0, years);
  }

  function fmtDate(dateISO, pattern) {
    const d = parseISO(dateISO);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthsFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if (pattern === "ddMMM") return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]}`;
    if (pattern === "ddMM") return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (pattern === "ddMMMyyyy") return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
    if (pattern === "MMMMyyyy") return `${monthsFull[d.getMonth()]} ${d.getFullYear()}`;
    if (pattern === "long") return `${monthsFull[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    return d.toLocaleDateString();
  }

  function weekdayInCurrentYear(dateISO) {
    const d = parseISO(dateISO);
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const now = new Date();
    const inCurYear = new Date(now.getFullYear(), d.getMonth(), d.getDate());
    return weekdays[inCurYear.getDay()];
  }

  function eventTypeIcon(eventType) {
    if (eventType.kind === "birthday") return "🎂";
    if (eventType.kind === "anniversary") return "❤️";
    return eventType.icon || "⭐";
  }
  function eventTypeColorClass(eventType) {
    if (eventType.kind === "birthday") return "badge-birthday";
    if (eventType.kind === "anniversary") return "badge-anniversary";
    return "badge-custom";
  }
  function eventTypeLabel(eventType) {
    if (eventType.kind === "birthday") return "Birthday";
    if (eventType.kind === "anniversary") return "Anniversary";
    return eventType.name || "Custom";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  // ---------- Confirm dialog ----------
  function showConfirm(title, msg, okLabel, onOk) {
    const overlay = document.getElementById("confirm-overlay");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-msg").textContent = msg;
    const okBtn = document.getElementById("confirm-ok");
    okBtn.textContent = okLabel;
    overlay.classList.remove("hidden");
    function cleanup() { overlay.classList.add("hidden"); okBtn.removeEventListener("click", okHandler); cancelBtn.removeEventListener("click", cancelHandler); }
    function okHandler() { cleanup(); onOk(); }
    function cancelHandler() { cleanup(); }
    const cancelBtn = document.getElementById("confirm-cancel");
    okBtn.addEventListener("click", okHandler);
    cancelBtn.addEventListener("click", cancelHandler);
  }

  // ---------- Tabs ----------
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
      document.getElementById("screen-" + btn.dataset.tab).classList.add("active");
      renderActive();
    });
  });

  function renderActive() {
    if (state.activeTab === "home") renderHome();
    else if (state.activeTab === "calendar") renderCalendar();
    else if (state.activeTab === "timeline") renderTimeline();
  }

  // ================= HOME =================
  function avatarHtml(ev) {
    if (ev.photoData) {
      return `<img class="avatar-photo" src="${ev.photoData}">`;
    }
    return `<div class="avatar-fallback">${escapeHtml((ev.name || "?").substring(0, 1).toUpperCase())}</div>`;
  }

  function homeFilteredEvents() {
    const f = state.home;
    let list = state.events.filter((ev) => {
      if (!ev.shouldDisplay) return false;
      if (ev.eventType.kind === "birthday") return f.showBirthdays;
      if (ev.eventType.kind === "anniversary") return f.showAnniversaries;
      return f.showCustom;
    });
    if (f.search.trim()) {
      const q = f.search.toLowerCase();
      list = list.filter((ev) =>
        (ev.name || "").toLowerCase().includes(q) ||
        (ev.notes || "").toLowerCase().includes(q) ||
        (ev.eventType.kind === "custom" && (ev.eventType.name || "").toLowerCase().includes(q))
      );
    }
    return list;
  }

  function eventInfoLine(ev) {
    const date = fmtDate(ev.date, "ddMM") + " • " + weekdayInCurrentYear(ev.date);
    const years = yearsSince(ev.date);
    return `Turning ${years + 1} • ${date}`;
  }

  function groupHomeEvents(list) {
    const sections = [];

    // "daysUntilNextOccurrence" always looks forward, so to find events that recently
    // passed (YESTERDAY) we separately compute how many days ago the most
    // recent occurrence was.
    function daysSinceLastOccurrence(dateISO) {
      const date = parseISO(dateISO);
      const t = startOfDay(new Date());
      const year = t.getFullYear();
      let last = new Date(year, date.getMonth(), date.getDate());
      if (last > t) last = new Date(year - 1, date.getMonth(), date.getDate());
      return daysBetween(last, t); // >=0
    }

    const yesterday = [], todayList = [], tomorrow = [], nextWeek = [], laterList = [];
    list.forEach((ev) => {
      const sinceLast = daysSinceLastOccurrence(ev.date);
      const until = daysUntilNextOccurrence(ev.date);
      if (sinceLast === 1) { yesterday.push({ ev, daysUntil: -1 }); return; }
      if (sinceLast === 0) { todayList.push({ ev, daysUntil: 0 }); return; }
      if (until === 1) { tomorrow.push({ ev, daysUntil: 1 }); return; }
      if (until >= 2 && until <= 7) { nextWeek.push({ ev, daysUntil: until }); return; }
      if (sinceLast >= 2 && sinceLast <= 7) { laterList.push({ ev, daysUntil: -sinceLast }); return; }
      laterList.push({ ev, daysUntil: until });
    });

    function sortByMonthDay(a, b) {
      const da = parseISO(a.ev.date), db = parseISO(b.ev.date);
      if (da.getMonth() !== db.getMonth()) return da.getMonth() - db.getMonth();
      return da.getDate() - db.getDate();
    }

    if (yesterday.length) sections.push(["YESTERDAY", yesterday.sort(sortByMonthDay)]);
    if (todayList.length) sections.push(["TODAY", todayList.sort(sortByMonthDay)]);
    if (tomorrow.length) sections.push(["TOMORROW", tomorrow.sort(sortByMonthDay)]);
    if (nextWeek.length) sections.push(["NEXT WEEK", nextWeek.sort(sortByMonthDay)]);

    const byMonth = {};
    laterList.forEach((item) => {
      const occ = addDays(startOfDay(new Date()), item.daysUntil);
      const key = fmtDate(toISO(occ), "MMMMyyyy");
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(item);
    });
    const monthKeys = Object.keys(byMonth).sort((a, b) => {
      function parseKey(k) {
        const [monName, y] = k.split(" ");
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        return new Date(parseInt(y), months.indexOf(monName), 1);
      }
      return parseKey(a) - parseKey(b);
    });
    monthKeys.forEach((k) => sections.push([k, byMonth[k].sort(sortByMonthDay)]));

    return sections;
  }

  function renderHome() {
    const list = homeFilteredEvents();
    const sections = groupHomeEvents(list);
    const container = document.getElementById("home-list");

    if (state.events.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="glyph">🎉</div><div>No events yet. Tap + to add a birthday, anniversary, or custom event.</div></div>`;
      return;
    }
    if (sections.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="glyph">🔍</div><div>No events match your filters.</div></div>`;
      return;
    }

    let html = "";
    sections.forEach(([label, items]) => {
      const showDays = !(label === "YESTERDAY" || label === "TODAY" || label === "TOMORROW");
      const isToday = label === "TODAY";
      html += `<div class="section-header"><div class="line"></div><div class="label">${escapeHtml(label)}</div><div class="line"></div></div>`;
      items.forEach(({ ev, daysUntil }) => {
        html += `
          <div class="event-row ${isToday ? "event-row-today" : ""}" data-open-edit="${ev.id}">
            <div class="avatar">
              ${avatarHtml(ev)}
              <div class="avatar-badge ${eventTypeColorClass(ev.eventType)}">${eventTypeIcon(ev.eventType)}</div>
            </div>
            <div class="event-main">
              <div class="event-name">${escapeHtml(ev.name)} (${parseISO(ev.date).getFullYear()})${isToday ? ' <span class="today-tag">🎉 Today</span>' : ""}</div>
              <div class="event-sub">${escapeHtml(eventInfoLine(ev))}</div>
            </div>
            ${showDays ? `<div class="event-days"><div class="num">${Math.abs(daysUntil)}</div><div class="lbl">days</div></div>` : ""}
          </div>`;
      });
    });
    container.innerHTML = html;

    container.querySelectorAll("[data-open-edit]").forEach((el) => {
      el.addEventListener("click", () => openEventSheet(el.dataset.openEdit));
    });
  }

  ["birthday", "anniversary", "custom"].forEach((kind) => {
    document.getElementById("f-" + kind).addEventListener("click", (e) => {
      const key = kind === "birthday" ? "showBirthdays" : kind === "anniversary" ? "showAnniversaries" : "showCustom";
      state.home[key] = !state.home[key];
      e.currentTarget.classList.toggle("active", state.home[key]);
      renderHome();
    });
  });
  document.getElementById("btn-search").addEventListener("click", () => {
    state.home.searching = !state.home.searching;
    document.getElementById("search-bar").style.display = state.home.searching ? "flex" : "none";
    if (state.home.searching) document.getElementById("search-input").focus();
  });
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.home.search = e.target.value;
    renderHome();
  });
  document.getElementById("search-clear").addEventListener("click", () => {
    state.home.search = "";
    document.getElementById("search-input").value = "";
    renderHome();
  });
  document.getElementById("btn-add").addEventListener("click", () => openEventSheet(null));

  // ================= CALENDAR =================
  function calFilteredEventsForMonthDay(month, day) {
    return state.events.filter((ev) => {
      if (!ev.shouldDisplay) return false;
      const d = parseISO(ev.date);
      if (d.getMonth() !== month || d.getDate() !== day) return false;
      if (ev.eventType.kind === "birthday") return state.cal.showBirthdays;
      if (ev.eventType.kind === "anniversary") return state.cal.showAnniversaries;
      return state.cal.showCustom;
    });
  }

  function renderCalendar() {
    const c = state.cal;
    document.getElementById("cal-month-label").textContent = fmtDate(toISO(new Date(c.month.getFullYear(), c.month.getMonth(), 1)), "MMMMyyyy");

    const year = c.month.getFullYear(), month = c.month.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = firstDay.getDay();

    let cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);

    let html = "";
    cells.forEach((d) => {
      if (!d) { html += `<div class="cal-cell" style="border-color:transparent;"></div>`; return; }
      const isSelected = startOfDay(d).getTime() === startOfDay(c.selected).getTime();
      const evs = calFilteredEventsForMonthDay(d.getMonth(), d.getDate());
      let evHtml = "";
      evs.slice(0, 2).forEach((ev) => {
        evHtml += `<div class="ev">${eventTypeIcon(ev.eventType)} ${escapeHtml(ev.name)}</div>`;
      });
      let moreHtml = evs.length > 2 ? `<div class="more">+${evs.length - 2} more</div>` : "";
      html += `<div class="cal-cell ${isSelected ? "selected" : ""}" data-date="${toISO(d)}">
        <div class="daynum">${d.getDate()}</div>
        ${evHtml}${moreHtml}
      </div>`;
    });
    document.getElementById("cal-grid").innerHTML = html;
    document.querySelectorAll("#cal-grid .cal-cell[data-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        state.cal.selected = parseISO(cell.dataset.date);
        renderCalendar();
      });
    });

    document.getElementById("cal-events-title").textContent = "Events on " + fmtDate(toISO(c.selected), "long");
    const dayEvents = calFilteredEventsForMonthDay(c.selected.getMonth(), c.selected.getDate());
    const listEl = document.getElementById("cal-events-list");
    if (dayEvents.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><div class="glyph">📅</div><div>No events on this date</div></div>`;
    } else {
      listEl.innerHTML = dayEvents.map((ev) => {
        const until = daysUntilNextOccurrence(ev.date);
        const years = yearsSince(ev.date);
        return `<div class="cal-event-card" data-open-edit-cal="${ev.id}">
          <div class="avatar">${avatarHtml(ev)}</div>
          <div style="flex:1; min-width:0;">
            <div class="name">${escapeHtml(ev.name)}</div>
            <div class="meta">Turning ${years + 1} • ${fmtDate(ev.date, "ddMM")} • ${weekdayInCurrentYear(ev.date)}</div>
          </div>
          <div class="days"><div class="n">${until}</div><div class="l">days</div></div>
        </div>`;
      }).join("");
      listEl.querySelectorAll("[data-open-edit-cal]").forEach((el) => {
        el.addEventListener("click", () => openEventSheet(el.dataset.openEditCal));
      });
    }
  }

  ["birthday", "anniversary", "custom"].forEach((kind) => {
    document.getElementById("cf-" + kind).addEventListener("click", (e) => {
      const key = kind === "birthday" ? "showBirthdays" : kind === "anniversary" ? "showAnniversaries" : "showCustom";
      state.cal[key] = !state.cal[key];
      e.currentTarget.classList.toggle("active", state.cal[key]);
      renderCalendar();
    });
  });
  document.getElementById("cal-prev").addEventListener("click", () => {
    state.cal.month = new Date(state.cal.month.getFullYear(), state.cal.month.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", () => {
    state.cal.month = new Date(state.cal.month.getFullYear(), state.cal.month.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById("cal-today").addEventListener("click", () => {
    state.cal.month = new Date();
    state.cal.selected = new Date();
    renderCalendar();
  });

  // ================= TIMELINE =================
  function renderTimeline() {
    const f = state.tl;
    const filtered = state.events.filter((ev) => {
      if (ev.eventType.kind === "birthday") return f.showBirthdays;
      if (ev.eventType.kind === "anniversary") return f.showAnniversaries;
      return f.showCustom;
    });
    const sorted = filtered.slice().sort((a, b) => parseISO(a.date) - parseISO(b.date));
    const groups = {};
    sorted.forEach((ev) => {
      const year = parseISO(ev.date).getFullYear();
      const decade = Math.floor(year / 10) * 10;
      if (!groups[decade]) groups[decade] = [];
      groups[decade].push(ev);
    });
    const decades = Object.keys(groups).sort((a, b) => a - b);
    const container = document.getElementById("timeline-list");
    if (decades.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="glyph">🕐</div><div>No events to show.</div></div>`;
      return;
    }
    let html = "";
    decades.forEach((dec) => {
      html += `<div class="decade-header">${dec}</div>`;
      groups[dec].forEach((ev) => {
        const today = new Date();
        const d = parseISO(ev.date);
        let years = today.getFullYear() - d.getFullYear();
        let months = today.getMonth() - d.getMonth();
        if (months < 0) { years--; months += 12; }
        if (today.getDate() < d.getDate()) { months--; if (months < 0) { months += 12; years--; } }
        html += `<div class="tl-row" data-open-edit-tl="${ev.id}">
          <span class="icon">${eventTypeIcon(ev.eventType)}</span>
          <span class="date">${fmtDate(ev.date, "ddMMMyyyy")}</span>
          <span class="name">${escapeHtml(ev.name)}</span>
          <span class="age">${years} y ${months} m</span>
        </div>`;
      });
    });
    container.innerHTML = html;
    container.querySelectorAll("[data-open-edit-tl]").forEach((el) => {
      el.addEventListener("click", () => openEventSheet(el.dataset.openEditTl));
    });
  }

  ["birthday", "anniversary", "custom"].forEach((kind) => {
    document.getElementById("tf-" + kind).addEventListener("click", (e) => {
      const key = kind === "birthday" ? "showBirthdays" : kind === "anniversary" ? "showAnniversaries" : "showCustom";
      state.tl[key] = !state.tl[key];
      e.currentTarget.classList.toggle("active", state.tl[key]);
      renderTimeline();
    });
  });

  // ================= SETTINGS =================
  function applyDarkMode(on) {
    document.body.classList.toggle("dark", on);
    document.getElementById("dark-icon").textContent = on ? "🌙" : "☀️";
    document.getElementById("dark-toggle").checked = on;
    localStorage.setItem(DARK_KEY, on ? "1" : "0");
  }
  document.getElementById("dark-toggle").addEventListener("change", (e) => applyDarkMode(e.target.checked));
  applyDarkMode(localStorage.getItem(DARK_KEY) === "1");

  document.getElementById("btn-delete-all").addEventListener("click", () => {
    showConfirm("Delete All Events", "Are you sure you want to delete all events? This action cannot be undone.", "Delete", () => {
      state.events = [];
      saveEvents();
      renderActive();
      showToast("All events have been deleted");
    });
  });

  function csvEscape(v) {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  document.getElementById("btn-export-csv").addEventListener("click", () => {
    const header = ["id", "name", "date", "eventType", "customName", "customIcon", "notes", "shouldDisplay", "photoData"];
    const rows = [header.join(",")];
    state.events.forEach((ev) => {
      const row = [
        ev.id, ev.name, ev.date, ev.eventType.kind,
        ev.eventType.kind === "custom" ? ev.eventType.name : "",
        ev.eventType.kind === "custom" ? ev.eventType.icon : "",
        ev.notes || "", ev.shouldDisplay ? "true" : "false",
        ev.photoData || "",
      ].map(csvEscape);
      rows.push(row.join(","));
    });
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "events_export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Events exported successfully to CSV");
  });

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = ""; rows.push(row); row = [];
        } else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  }

  document.getElementById("btn-import-csv").addEventListener("click", () => {
    document.getElementById("csvFileInput").click();
  });
  document.getElementById("csvFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(reader.result);
        if (rows.length < 2) { showToast("No events found in file"); return; }
        const header = rows[0].map((h) => h.trim());
        const idx = (name) => header.indexOf(name);
        const imported = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[idx("name")]) continue;
          const kind = (r[idx("eventType")] || "birthday").trim();
          let eventType;
          if (kind === "custom") eventType = { kind: "custom", name: r[idx("customName")] || "Event", icon: r[idx("customIcon")] || "⭐" };
          else eventType = { kind: kind === "anniversary" ? "anniversary" : "birthday" };
          imported.push({
            id: r[idx("id")] || uuid(),
            name: r[idx("name")],
            date: r[idx("date")],
            eventType,
            notes: r[idx("notes")] || "",
            photoData: idx("photoData") >= 0 ? (r[idx("photoData")] || null) : null,
            shouldDisplay: idx("shouldDisplay") >= 0 ? r[idx("shouldDisplay")] !== "false" : true,
          });
        }
        const existingIds = new Set(state.events.map((e) => e.id));
        const newOnes = imported.filter((e) => !existingIds.has(e.id));
        state.events = state.events.concat(newOnes);
        saveEvents();
        renderActive();
        showToast(`Import successful! Added ${newOnes.length} new events. Skipped ${imported.length - newOnes.length} duplicate events.`);
      } catch (err) {
        console.error(err);
        showToast("Failed to import file: " + err.message);
      }
      document.getElementById("csvFileInput").value = "";
    };
    reader.readAsText(file);
  });

  // ================= ADD / EDIT SHEET =================
  const CUSTOM_ICONS = ["⭐", "❤️", "🎂", "🎉", "🎈", "👑", "🏆", "✈️", "🚗", "🚌", "⛵", "🚲", "🥎", "⚽", "🏀", "💃", "🏃", "⛷️", "🏊", "⛳", "🎓", "📚", "💼", "💻", "✏️", "📏", "🏠", "🛏️", "🍴", "🍷", "📷", "🎵", "☀️", "🌙", "☁️", "🍃", "🐾", "🔥", "✨", "🔔", "🚩", "🎖️", "🎫", "🎮", "📺", "🎧"];

  let tempPhotoData = null;

  function openEventSheet(eventId) {
    state.editingEventId = eventId;
    const overlay = document.getElementById("event-sheet-overlay");
    const sheet = document.getElementById("event-sheet");
    const existing = eventId ? state.events.find((e) => e.id === eventId) : null;
    tempPhotoData = existing ? existing.photoData : null;

    if (!existing) {
      // Step 1: choose name + type (mirrors AddEventView -> AddXView flow, combined into one form for simplicity)
      sheet.innerHTML = buildAddForm();
    } else {
      sheet.innerHTML = buildEditForm(existing);
    }
    overlay.classList.remove("hidden");
    wireSheetEvents(existing);
  }

  function closeSheet() {
    document.getElementById("event-sheet-overlay").classList.add("hidden");
    tempPhotoData = null;
  }

  function buildAddForm() {
    return `
      <div class="sheet-header">
        <button data-action="cancel">Cancel</button>
        <div class="sheet-title">Add Event</div>
        <span style="width:44px;"></span>
      </div>
      <div class="sheet-body">
        <div class="photo-picker">
          <div class="photo-circle" id="photo-circle">${tempPhotoData ? `<img src="${tempPhotoData}">` : `<span class="plus">➕</span>`}</div>
          <label for="photo-input">Change Photo</label>
          <input type="file" id="photo-input" accept="image/*" style="display:none;">
        </div>
        <div class="field-label">Name</div>
        <input type="text" class="text-input" id="input-name" placeholder="Name">

        <div class="field-label" style="margin-top:20px;">Event Type</div>
        <div class="type-card" id="type-birthday">🎂<span class="lbl">Birthday</span><span class="go">Add</span></div>
        <div class="type-card" id="type-anniversary">❤️<span class="lbl">Anniversary</span><span class="go">Add</span></div>
        <div class="type-card" id="type-custom">✏️<span class="lbl">Custom Event</span><span class="go">Add</span></div>

        <div id="details-section" style="display:none;">
          <div class="field-label" id="date-label">Date</div>
          <input type="date" class="date-input" id="input-date">

          <div id="custom-name-wrap" style="display:none;">
            <div class="field-label">Event Name</div>
            <input type="text" class="text-input" id="input-custom-name" placeholder="e.g. Graduation">
            <div class="field-label">Choose Icon</div>
            <div class="icon-grid" id="icon-grid"></div>
          </div>

          <div class="toggle-row">
            <span id="show-toggle-label">Show on Party screen</span>
            <label class="switch"><input type="checkbox" id="input-show" checked><span class="slider"></span></label>
          </div>

          <div class="field-label">Additional Notes</div>
          <textarea id="input-notes" placeholder="Notes"></textarea>

          <div style="height:20px;"></div>
          <button class="type-card" id="btn-save-new" style="justify-content:center; background:var(--blue); color:#fff; border:none; font-weight:600;">Save Event</button>
        </div>
      </div>
    `;
  }

  function buildEditForm(ev) {
    const isCustom = ev.eventType.kind === "custom";
    return `
      <div class="sheet-header">
        <button data-action="cancel">Cancel</button>
        <div class="sheet-title">Edit Event</div>
        <button class="save" data-action="save-edit">Save</button>
      </div>
      <div class="sheet-body">
        <div class="photo-picker">
          <div class="photo-circle" id="photo-circle">${tempPhotoData ? `<img src="${tempPhotoData}">` : `<span class="plus">➕</span>`}</div>
          <label for="photo-input">Change Photo</label>
          <input type="file" id="photo-input" accept="image/*" style="display:none;">
        </div>
        <div class="field-label">Name</div>
        <input type="text" class="text-input" id="input-name" value="${escapeHtml(ev.name)}">

        <div class="field-label">Event</div>
        ${isCustom
          ? `<input type="text" class="text-input" id="input-custom-name" value="${escapeHtml(ev.eventType.name)}">`
          : `<div style="padding:12px; color:var(--secondary);">${eventTypeLabel(ev.eventType)}</div>`}

        <div class="field-label">Date</div>
        <input type="date" class="date-input" id="input-date" value="${ev.date}">

        ${isCustom ? `<div class="field-label">Choose Icon</div><div class="icon-grid" id="icon-grid"></div>` : ""}

        <div class="toggle-row">
          <span>Show on Party screen</span>
          <label class="switch"><input type="checkbox" id="input-show" ${ev.shouldDisplay ? "checked" : ""}><span class="slider"></span></label>
        </div>

        <div class="field-label">Additional Notes</div>
        <textarea id="input-notes">${escapeHtml(ev.notes || "")}</textarea>

        <div style="height:10px;"></div>
        <button class="type-card" style="justify-content:center; color:var(--red); border-color:var(--red); font-weight:600;" id="btn-delete-from-edit">Delete Event</button>
      </div>
    `;
  }

  function renderIconGrid(selectedIcon) {
    const grid = document.getElementById("icon-grid");
    if (!grid) return;
    grid.innerHTML = CUSTOM_ICONS.map((ic) =>
      `<div class="icon-choice ${ic === selectedIcon ? "selected" : ""}" data-icon="${ic}">${ic}</div>`
    ).join("");
    grid.querySelectorAll(".icon-choice").forEach((el) => {
      el.addEventListener("click", () => {
        grid.querySelectorAll(".icon-choice").forEach((x) => x.classList.remove("selected"));
        el.classList.add("selected");
      });
    });
  }

  function getSelectedIcon() {
    const sel = document.querySelector("#icon-grid .icon-choice.selected");
    return sel ? sel.dataset.icon : CUSTOM_ICONS[0];
  }

  function wirePhotoInput() {
    const input = document.getElementById("photo-input");
    const circle = document.getElementById("photo-circle");
    if (!input) return;
    circle.addEventListener("click", () => input.click());
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxSize = 400;
          let w = img.width, h = img.height;
          if (w > h && w > maxSize) { h = h * (maxSize / w); w = maxSize; }
          else if (h > maxSize) { w = w * (maxSize / h); h = maxSize; }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          tempPhotoData = canvas.toDataURL("image/jpeg", 0.8);
          circle.innerHTML = `<img src="${tempPhotoData}">`;
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function wireSheetEvents(existing) {
    wirePhotoInput();
    const sheet = document.getElementById("event-sheet");
    sheet.querySelectorAll('[data-action="cancel"]').forEach((b) => b.addEventListener("click", closeSheet));

    if (!existing) {
      let chosenType = null;
      const typeCards = { birthday: document.getElementById("type-birthday"), anniversary: document.getElementById("type-anniversary"), custom: document.getElementById("type-custom") };
      const detailsSection = document.getElementById("details-section");
      const customWrap = document.getElementById("custom-name-wrap");
      const dateLabel = document.getElementById("date-label");
      const showLabel = document.getElementById("show-toggle-label");

      Object.entries(typeCards).forEach(([kind, card]) => {
        card.addEventListener("click", () => {
          const name = document.getElementById("input-name").value.trim();
          if (!name) { showToast("Please enter a name first"); return; }
          chosenType = kind;
          Object.values(typeCards).forEach((c) => c.style.background = "var(--card)");
          card.style.background = "rgba(59,130,246,0.12)";
          detailsSection.style.display = "block";
          customWrap.style.display = kind === "custom" ? "block" : "none";
          dateLabel.textContent = kind === "birthday" ? "Birth Date" : kind === "anniversary" ? "Anniversary Date" : "Event Date";
          showLabel.textContent = kind === "custom" ? "Show event in Home View" : "Party";
          if (kind === "custom") renderIconGrid(CUSTOM_ICONS[0]);
          detailsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });

      document.getElementById("btn-save-new").addEventListener("click", () => {
        const name = document.getElementById("input-name").value.trim();
        const dateVal = document.getElementById("input-date").value;
        if (!name) { showToast("Please enter a name"); return; }
        if (!chosenType) { showToast("Please choose an event type"); return; }
        if (!dateVal) { showToast("Please choose a date"); return; }
        let eventType;
        if (chosenType === "custom") {
          const customName = document.getElementById("input-custom-name").value.trim();
          if (!customName) { showToast("Please enter an event name"); return; }
          eventType = { kind: "custom", name: customName, icon: getSelectedIcon() };
        } else {
          eventType = { kind: chosenType };
        }
        const newEvent = {
          id: uuid(),
          name,
          date: dateVal,
          eventType,
          notes: document.getElementById("input-notes").value.trim() || "",
          photoData: tempPhotoData,
          shouldDisplay: document.getElementById("input-show").checked,
        };
        state.events.push(newEvent);
        saveEvents();
        closeSheet();
        renderActive();
      });
    } else {
      if (existing.eventType.kind === "custom") renderIconGrid(existing.eventType.icon);
      sheet.querySelector('[data-action="save-edit"]').addEventListener("click", () => {
        const name = document.getElementById("input-name").value.trim();
        const dateVal = document.getElementById("input-date").value;
        if (!name || !dateVal) { showToast("Please fill in required fields"); return; }
        let eventType = existing.eventType;
        if (existing.eventType.kind === "custom") {
          const customName = document.getElementById("input-custom-name").value.trim();
          eventType = { kind: "custom", name: customName || existing.eventType.name, icon: getSelectedIcon() };
        }
        const updated = {
          id: existing.id,
          name,
          date: dateVal,
          eventType,
          notes: document.getElementById("input-notes").value.trim() || "",
          photoData: tempPhotoData,
          shouldDisplay: document.getElementById("input-show").checked,
        };
        const idx = state.events.findIndex((e) => e.id === existing.id);
        state.events[idx] = updated;
        saveEvents();
        closeSheet();
        renderActive();
      });
      document.getElementById("btn-delete-from-edit").addEventListener("click", () => {
        showConfirm("Delete Event", `Delete "${existing.name}"? This can't be undone.`, "Delete", () => {
          state.events = state.events.filter((e) => e.id !== existing.id);
          saveEvents();
          closeSheet();
          renderActive();
        });
      });
    }
  }

  document.getElementById("event-sheet-overlay").addEventListener("click", (e) => {
    if (e.target.id === "event-sheet-overlay") closeSheet();
  });

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        // Check the server for a newer sw.js every time the app loads.
        reg.update();
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "activated") {
              // A newer version just took over — reload once so the fresh
              // index.html/app.js are actually used instead of the old ones
              // still sitting in memory.
              window.location.reload();
            }
          });
        });
      }).catch((e) => console.log("SW registration failed", e));
    });
  }

  // ---------- Init ----------
  (async function initApp() {
    let events = await loadEventsFromDB();
    if (events.length === 0) {
      const legacy = loadLegacyLocalStorageEvents();
      if (legacy.length > 0) {
        events = legacy;
        state.events = events;
        await saveEvents(); // migrate into IndexedDB immediately
      }
    }
    state.events = events;
    renderHome();
    renderCalendar();
    renderTimeline();
  })();
})();

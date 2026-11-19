// Mixmix: Habitat's radio. One shared programme (every set marked for the radio, in order, looping
// since a fixed date, so everyone hears the same second), an archive to play any set from, and the
// hills around Cà de Monti drawn as contour lines that move with the music.
import * as THREE from "./vendor/three.module.min.js";
import { programme } from "./radio.js?v=20261023";

const $ = (id) => document.getElementById(id);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + ":" + String(x).padStart(2, "0");
};
const span = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}\u00a0h\u00a0${String(m % 60).padStart(2, "0")}` : `${m}\u00a0min`; };
const day = (iso) => { const d = new Date(iso + "T12:00:00Z"); return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---- Data: from the Habitat backend (window.MIXMIX_API, set from ../config.js) ----
const API = String(window.MIXMIX_API ?? "").replace(/\/$/, "") + "/mixmix";
let SETS = [], LISTS = [], SCHED = [];
try {
  const r = await (await fetch(`${API}/state`, { cache: "no-cache" })).json();
  SETS = r.sets.filter((s) => s.file && s.duration > 0);
  SCHED = r.schedule ?? [];
  LISTS = (r.playlists ?? []).map((p) => ({ ...p, sets: SETS.filter((s) => s.playlist === p.id) })).filter((p) => p.sets.length);
} catch { /* the page says the archive is empty */ }
const listOf = (s) => LISTS.find((p) => p.id === s.playlist);
const media = (s) => `${API}/media/${encodeURIComponent(s.file)}`;
/** A cover: the colour one, or the 1-bit one; the version keeps a replaced cover from coming back from the cache. */
const coverUrl = (s, bw) => `${API}/covers/${encodeURIComponent(s.cover)}${bw ? "-1bit.png" : ".webp"}?v=${encodeURIComponent(s.added ?? "")}`;
// The minimal page (minimal.html) shows the covers in 1-bit black and white, the one playing in colour.
const MIN = !!window.MIXMIX_MINIMAL;
const label = (s) => [s.title, s.event].filter(Boolean).join(" · ");

/** What the radio is playing now, where in it, and what comes next (the loop, or a scheduled set: radio.js). */
function onAir(now = Date.now()) {
  const p = programme(SETS, SCHED, now);
  return p && { ...p, next: programme(SETS, SCHED, p.end)?.set ?? null };
}
// The schedule can change while the page is open: read it again every few minutes.
setInterval(() => fetch(`${API}/state`, { cache: "no-cache" }).then((r) => r.json()).then((r) => { SCHED = r.schedule ?? []; }).catch(() => {}), 5 * 60_000);

// ---- Player: the radio, or one set from the archive ----
const audio = new Audio();
audio.crossOrigin = "anonymous";               // the backend answers with CORS: the map can read the music's levels
audio.preload = "none";
let mode = "radio", current = null, dragging = false, queue = null;   // mode: radio | set | list
let target = null, opener = null;                 // what the share menu is for, and the icon that opened it
let heardS = 0, counted = false, lastTick = 0, lastMode = "radio";   // the listen counter (below)
let STATS = null;                                  // the latest counts from api/stats
let airStart = 0, airCheck = 0;                    // when the radio's current item started (to notice a scheduled cut)

function load(set, at) {
  if (current !== set || mode !== lastMode) { heardS = 0; counted = false; }
  lastMode = mode;
  current = set;
  const src = media(set);
  if (!audio.src.endsWith(src)) audio.src = src;
  const go = () => { try { audio.currentTime = at; } catch {} audio.play().catch(() => paint()); };
  if (audio.readyState >= 1) go(); else audio.addEventListener("loadedmetadata", go, { once: true });
  if (audio.readyState < 1) audio.load();
  setSession(set);
  paint();
}
/** A set ready to play, from a shared link: shown in the box, starts on play. */
function cue(set) { mode = "set"; queue = null; current = set; audio.pause(); audio.src = media(set); setSession(set); paint(); }
function tuneIn() { const a = onAir(); if (!a) return; mode = "radio"; airStart = a.start; load(a.set, a.at); }
function playSet(set, at = 0) { mode = "set"; queue = null; load(set, at); }
/** A playlist, in order, from one of its sets. */
function playList(p, i = 0, at = 0) { mode = "list"; queue = { p, i }; load(p.sets[i], at); }
function toggle() {
  if (!audio.paused) { audio.pause(); return; }
  if (mode === "radio" || !current) tuneIn(); else audio.play().catch(() => {});
}
audio.addEventListener("ended", () => {
  if (mode === "radio") tuneIn();
  else if (mode === "list" && queue.i + 1 < queue.p.sets.length) playList(queue.p, queue.i + 1);
  else paint();
});
["play", "pause", "waiting", "playing", "loadedmetadata"].forEach((e) => audio.addEventListener(e, paint));
audio.addEventListener("timeupdate", () => {
  if (!dragging) paint();
  heard();
  // On the radio, a scheduled set can start in the middle of another: follow the programme.
  if (mode === "radio" && !audio.paused && performance.now() - airCheck > 3000) {
    airCheck = performance.now();
    const a = onAir();
    if (a && Math.abs(a.start - airStart) > 1000) tuneIn();
  }
});

$("play").addEventListener("click", toggle);
$("back").addEventListener("click", tuneIn);
$("next").addEventListener("click", (e) => {
  if (!e.target.closest(".nx")) return;
  if (mode === "list" && queue.i + 1 < queue.p.sets.length) playList(queue.p, queue.i + 1);
  else if (mode === "radio") { const a = onAir(); if (a?.next) playSet(a.next); }   // like dragging: leaves the radio for that set
});

// The cursor: drag anywhere in the set. On the radio, moving it leaves the radio for that set.
const seek = $("seek"), rail = $("rail");
const shown = () => (mode === "radio" && audio.paused ? onAir() : null);
seek.addEventListener("input", () => {
  dragging = true;
  const s = current && !shown() ? current : onAir()?.set;
  if (!s) return;
  const at = (seek.value / 1000) * s.duration;
  rail.style.setProperty("--p", seek.value / 10 + "%");
  $("t0").textContent = fmt(at);
  $("t1").textContent = "−" + fmt(s.duration - at);
});
seek.addEventListener("change", () => {
  const s = current && !shown() ? current : onAir()?.set;
  dragging = false;
  if (!s) return;
  const at = (seek.value / 1000) * s.duration;
  if (mode === "list") playList(queue.p, queue.i, at); else playSet(s, at);
});

// ---- Lock screen and headphone controls ----
function setSession(s) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: s.title || s.artist, artist: s.artist, album: "mixmix · " + (s.event || "Habitat"), artwork: s.cover ? [{ src: new URL(coverUrl(s), location.href).href, sizes: "640x640", type: "image/webp" }] : [] });
}
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", toggle);
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("seekto", (d) => { if (current) mode === "list" ? playList(queue.p, queue.i, d.seekTime) : playSet(current, d.seekTime); });
  navigator.mediaSession.setActionHandler("nexttrack", () => { if (mode === "list" && queue.i + 1 < queue.p.sets.length) playList(queue.p, queue.i + 1); });
  navigator.mediaSession.setActionHandler("previoustrack", () => { if (mode === "list" && queue.i > 0) playList(queue.p, queue.i - 1); });
}

// ---- Paint the legend box and the archive ----
/** The name on one line if it can be (down to 32 px), and the box never over the wordmark (down to 26 px). */
let fitAfter = false;
function fit() {
  const a = $("artist"), box = $("air"), wm = document.querySelector(".wordmark");
  a.style.fontSize = "";
  const limit = wm.getBoundingClientRect().bottom + parseFloat(getComputedStyle(wm).fontSize) * 0.12 + 16;   // birbi's ink hangs below its box
  const full = parseFloat(getComputedStyle(a).fontSize);
  let fs = full;
  const lines = () => Math.round(a.getBoundingClientRect().height / (fs * 0.92 * (box.getBoundingClientRect().width / box.offsetWidth || 1)));
  while (fs > 32 && lines() > 1) { fs -= 2; a.style.fontSize = fs + "px"; }
  if (lines() > 1) { fs = full; a.style.fontSize = ""; }   // can't be one line (phones): keep the full size on two
  while (fs > 26 && box.getBoundingClientRect().top < limit) { fs -= 2; a.style.fontSize = fs + "px"; }
}
addEventListener("resize", fit);
document.fonts?.ready.then(() => fit());
function paint() {
  const a = onAir();
  const s = (mode === "set" || !audio.paused) && current ? current : a?.set;
  if (!s) {
    $("artist").textContent = "mixmix";
    $("desc").textContent = "The archive is empty for now.";
    $("desc").hidden = false;
    $("play").disabled = true;
    return;
  }
  const at = (mode === "radio" && audio.paused) || !current ? a.at : audio.currentTime;
  const playing = !audio.paused;
  $("air").classList.toggle("off", mode !== "radio");
  $("air").classList.toggle("playing", !audio.paused);
  $("where").textContent = mode === "list" ? `${queue.p.name} · ${queue.i + 1} of ${queue.p.sets.length}` : mode === "radio" ? listeners() : "";
  if ($("artist").textContent !== s.artist || $("desc").textContent !== (s.description ?? "")) { $("artist").textContent = s.artist; fitAfter = true; }
  const p = listOf(s);                               // under the name: its playlist, a way into it, then a few words
  $("pl").hidden = !p;
  if (p) { $("pl-link").textContent = p.name; $("pl-link").href = "#playlist/" + encodeURIComponent(p.id); }
  $("desc").hidden = !s.description;
  $("desc").textContent = s.description ?? "";
  if (fitAfter) { fitAfter = false; fit(); }
  if (!dragging) {
    const p = Math.min(1000, Math.round((1000 * at) / s.duration));
    seek.value = p;
    rail.style.setProperty("--p", p / 10 + "%");
    $("t0").textContent = fmt(at);
    $("t1").textContent = "−" + fmt(s.duration - at);
  }
  seek.setAttribute("aria-valuetext", `${fmt(at)} of ${fmt(s.duration)}`);
  const after = mode === "list" ? queue.p.sets[queue.i + 1] : null;
  const nx = mode === "radio" ? a?.next : after;     // next: the set itself, a click plays it
  const html = nx ? `next: <button class="nx" type="button" title="Play it now">${esc(nx.artist)}</button>` : "";
  if ($("next").innerHTML !== html) $("next").innerHTML = html;
  $("back").hidden = mode === "radio";
  const waiting = playing && audio.readyState < 3;
  $("play").classList.toggle("wait", waiting);
  $("play").setAttribute("aria-label", playing ? "Pause" : mode === "radio" ? "Listen to the radio" : "Resume");
  $("ico").setAttribute("d", playing ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M7 4l13 8-13 8z");
  paintMini(s, at, playing, p);
  if (MIN) document.querySelectorAll("img[data-set]").forEach((im) => {
    const col = playing && im.dataset.set === s.id;
    const src = col ? im.dataset.col : im.dataset.bw;
    if (im.getAttribute("src") !== src) { im.src = src; im.classList.toggle("bw", !col); }
  });
  document.querySelectorAll(".set").forEach((b) => b.classList.toggle("on", SETS[b.dataset.i] === s && playing));
  document.querySelectorAll(".all").forEach((b) => { b.lastChild.textContent = mode === "list" && queue.p.id === b.dataset.p && playing ? " playing" : " play the whole playlist"; });
}

// ---- The mini player: the same state, small, fixed at the bottom while the big player is off screen ----
function paintMini(s, at, playing, p) {
  $("mini-artist").textContent = s.artist;
  const sub = mode === "list" ? `${queue.p.name} · ${queue.i + 1} of ${queue.p.sets.length}` : mode === "radio" ? ["on air", p?.name].filter(Boolean).join(" · ") : p ? p.name : "from the archive";
  $("mini-sub").textContent = sub;
  $("mini-sub").classList.toggle("is-live", mode === "radio");
  $("mini-time").textContent = "−" + fmt(s.duration - at);
  $("mini-p").style.setProperty("--p", Math.min(100, (100 * at) / s.duration) + "%");
  const src = s.cover ? coverUrl(s) : "";
  if ($("mini-cover").getAttribute("src") !== src) { $("mini-cover").hidden = !src; if (src) $("mini-cover").src = src; }
  $("mini-play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("mini-ico").setAttribute("d", playing ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M7 4l13 8-13 8z");
}
$("mini-play").addEventListener("click", toggle);
$("mini-up").addEventListener("click", () => scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }));
new IntersectionObserver(([e]) => {
  const show = !e.isIntersecting;
  $("mini").classList.toggle("show", show);
  $("mini").inert = !show;
  document.body.classList.toggle("mini-on", show);
}).observe($("air"));

// ---- The archive: mixes (every set, newest first) and playlists (sets gathered by event) ----
const SHARE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>`;
const PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>`;
const img = (s, w = 96) => {
  if (!s.cover) return `<span class="noc" style="width:${w}px;height:${w}px">${esc((s.artist ?? "?").trim()[0] ?? "?")}</span>`;   // no cover: its initial
  const col = esc(coverUrl(s)), bw = esc(coverUrl(s, true));
  return MIN ? `<img class="bw" src="${bw}" data-set="${esc(s.id)}" data-bw="${bw}" data-col="${col}" alt="" width="${w}" height="${w}" loading="lazy">`
    : `<img src="${col}" alt="" width="${w}" height="${w}" loading="lazy">`;
};
const row = (s, k) => {
  const p = listOf(s), i = SETS.indexOf(s);
  const where = k == null && p ? `<span class="go" data-go="${esc(p.id)}" title="Open the playlist">${esc(p.name)}</span>` : esc(s.title ?? (p ? "" : s.event ?? ""));
  const share = `<button class="share" type="button" data-share="set:${esc(s.id)}" aria-expanded="false" aria-controls="sharebox" aria-label="${MIN ? "Copy the link to" : "Share"} ${esc(s.artist)}" title="${MIN ? "Copy the link" : "Share"}">${SHARE}</button>`;
  return `<li class="row"><button class="set" type="button" data-i="${i}"${k != null ? ` data-k="${k}"` : ""}><span class="cv">${img(s)}<span class="po">${PLAY}</span></span><span><span class="a">${k != null ? `<span class="k">${String(k + 1).padStart(2, "0")}</span>` : ""}${esc(s.artist)}</span><span class="e">${[where, day(s.date)].filter(Boolean).join(" · ")}</span></span><span class="d"><span class="pc" data-plays="${esc(s.id)}" hidden></span>${span(s.duration)}</span></button>${share}</li>`;
};
const total = (p) => span(p.sets.reduce((n, s) => n + s.duration, 0));
const newest = SETS.map((s, i) => [s, i]).sort((x, y) => (y[0].date ?? "").localeCompare(x[0].date ?? "") || x[1] - y[1]).map(([s]) => s);
$("n-mixes").textContent = SETS.length;
$("n-playlist").textContent = LISTS.length;
$("sets").innerHTML = SETS.length ? newest.map((s) => row(s)).join("") : `<li class="empty">The archive is empty for now.</li>`;
$("tiles").innerHTML = LISTS.length
  ? LISTS.map((p) => `<a class="tile" href="#playlist/${esc(p.id)}"><span class="mos">${p.sets.slice(0, 12).map((s) => img(s, 80)).join("")}</span><span class="n">${esc(p.name)}</span><span class="m">${esc([day(p.date), `${p.sets.length} recordings`, total(p)].filter(Boolean).join(" · "))}<span class="pc" data-plays-list="${esc(p.id)}" hidden></span></span></a>`).join("")
  : `<p class="empty">No playlists yet.</p>`;

function detail(p) {
  closeShare();                                     // the menu may sit in a row about to be replaced
  $("area-detail").innerHTML = `<p class="crumb"><a href="#playlist">← all playlists</a></p>
    <h2 class="pl-name">${esc(p.name)}</h2>
    <p class="meta">${p.title ? `<b>${esc(p.title)}</b><br>` : ""}${esc([day(p.date), p.place, `${p.sets.length} recordings`, total(p)].filter(Boolean).join(" · "))}<span class="pc" data-plays-list="${esc(p.id)}" hidden></span></p>
    <div class="sheet" style="--c:${Math.min(12, p.sets.length)}">${p.sets.map((s) => img(s, 128)).join("")}</div>
    <div class="pl-acts"><button class="all" type="button" data-p="${esc(p.id)}">${PLAY}<span> play the whole playlist</span></button><button class="share" type="button" data-share="list:${esc(p.id)}" aria-expanded="false" aria-controls="sharebox" aria-label="${MIN ? "Copy the link to" : "Share"} the playlist ${esc(p.name)}" title="${MIN ? "Copy the link" : "Share"}">${SHARE}</button></div>
    <ol class="sets">${p.sets.map((s, k) => row(s, k)).join("")}</ol>`;
}

/** #mixes, #playlist or #playlist/<id>: which part of the archive is open. */
function route(scroll) {
  const h = decodeURIComponent(location.hash.slice(1));
  const shared = h.startsWith("set/") && SETS.find((x) => x.id === h.slice(4));
  if (shared && current !== shared) { cue(shared); scroll = false; }
  const p = h.startsWith("playlist/") && LISTS.find((x) => x.id === h.slice(9));
  const tab = p || h === "playlist" ? "playlist" : "mixes";
  if (p) { detail(p); if (STATS) showStats(STATS); }
  $("area-mixes").hidden = tab !== "mixes";
  $("area-playlist").hidden = !!p || tab !== "playlist";
  $("area-detail").hidden = !p;
  for (const t of ["mixes", "playlist"]) $("tab-" + t).setAttribute("aria-selected", t === tab);
  if (scroll && h) $("archivio").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  paint();
}
addEventListener("hashchange", () => route(true));
route(location.hash.length > 1);

$("archivio").addEventListener("click", (e) => {
  const all = e.target.closest(".all");
  if (all) { playList(LISTS.find((p) => p.id === all.dataset.p)); return; }
  const go = e.target.closest("[data-go]");      // the playlist's name inside a mix row (a link can't sit in a button)
  if (go) { location.hash = "playlist/" + go.dataset.go; return; }
  const b = e.target.closest(".set");
  if (!b) return;
  const s = SETS[b.dataset.i];
  if (b.dataset.k != null) playList(listOf(s), +b.dataset.k); else playSet(s);
  if (innerWidth <= 760) scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
});
paint();
setInterval(() => { if (audio.paused && !dragging) paint(); }, 1000);

// ---- Listens: who is on the radio now, and how many times each set was heard ----
// Anonymous: a random id for this tab, nothing else. A listen is 30 s of real playing.
const TAB = (() => { try { return sessionStorage.mixmixTab ||= crypto.randomUUID().replace(/-/g, "").slice(0, 24); } catch { return crypto.randomUUID().replace(/-/g, "").slice(0, 24); } })();
const num = (n) => n.toLocaleString("en-GB");
const PLAYS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>`;
/** Plays as the play glyph and a number. */
function plays(e, n) {
  e.hidden = !n;
  e.innerHTML = n ? `${PLAYS}${num(n)}` : "";
  e.setAttribute("aria-label", n ? `${num(n)} ${n === 1 ? "play" : "plays"}` : "");
}
function listeners() {
  if (!STATS) return "";
  const now = STATS.now || (!audio.paused && mode === "radio" ? 1 : 0);
  return now ? `${num(now)} listening now` : "";
}
function showStats(st) {
  if (!st || typeof st.now !== "number") return;
  STATS = st;
  document.querySelectorAll("[data-plays]").forEach((e) => { const n = st.sets[e.dataset.plays] ?? 0; plays(e, n); });
  document.querySelectorAll("[data-plays-list]").forEach((e) => {
    const p = LISTS.find((x) => x.id === e.dataset.playsList), n = p ? p.sets.reduce((a, s) => a + (st.sets[s.id] ?? 0), 0) : 0;
    plays(e, n);
  });
  paint();
}
const api = (path, body) => fetch(`${API}/${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ c: TAB, ...body }) } : { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : null)).then(showStats).catch(() => {});
function heard() {
  const t = performance.now();
  if (!audio.paused && t - lastTick < 2000) heardS += (t - lastTick) / 1000;
  lastTick = t;
  if (!counted && heardS >= 30 && current) { counted = true; api("play", mode === "radio" ? { radio: true } : { id: current.id }); }
}
audio.addEventListener("play", () => { lastTick = performance.now(); if (mode === "radio") api("beat", {}); });
setInterval(() => { if (mode === "radio" && !audio.paused) api("beat", {}); else api("stats"); }, 20000);
api("stats");

// ---- Black: the only theme (the light tokens stay in the CSS, unused) ----
const root = document.documentElement;
let retone = () => {};                              // set by the map, to recolour its lines

// ---- Share: a link straight to a set or a playlist, or a picture for a story ----
// One small menu (link · story), moved next to whichever share icon was pressed.
const showing = () => (current && (mode !== "radio" || !audio.paused) ? current : onAir()?.set);
const say = (m) => { $("share-msg").textContent = m; };
const here = location.origin + location.pathname;

/** What a share icon stands for: the box's set (or the radio), one set, or a playlist. */
function resolve(key) {
  if (key === "now") {
    const s = showing();
    if (!s) return null;
    const p = listOf(s), radio = mode === "radio";
    return { set: s, url: radio ? here : here + "#set/" + encodeURIComponent(s.id), title: radio ? "mixmix, Habitat's radio" : `${s.artist} · mixmix`,
      where: radio ? "on air" : p ? `playlist ${p.name}` : "from Habitat's archive" };
  }
  if (key.startsWith("set:")) {
    const s = SETS.find((x) => x.id === key.slice(4)), p = s && listOf(s);
    return s && { set: s, url: here + "#set/" + encodeURIComponent(s.id), title: `${s.artist} · mixmix`, where: p ? `playlist ${p.name}` : "from Habitat's archive" };
  }
  const p = LISTS.find((x) => x.id === key.slice(5));
  return p && { list: p, url: here + "#playlist/" + encodeURIComponent(p.id), title: `${p.name} · mixmix`, where: "playlist" };
}
function closeShare() {
  const box = $("sharebox");
  box.hidden = true;
  opener?.setAttribute("aria-expanded", "false");
  opener = target = null;
  $("air").append(box);                             // home, so re-rendering a list never takes it away
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-share]");
  if (!b) { if (!e.target.closest("#sharebox")) closeShare(); return; }
  if (MIN) { copyLink(b.dataset.share); return; }  // minimal page: the share icon just copies the link
  const again = b === opener;
  closeShare();
  if (again) return;
  target = resolve(b.dataset.share);
  if (!target) return;
  opener = b;
  b.setAttribute("aria-expanded", "true");
  const box = $("sharebox");
  (b.closest("li.row") ?? b.closest(".pl-acts") ?? b.closest(".next")).after(box);
  box.hidden = false;
  say("");
});
/** Minimal page: the link to that set (on the radio too: the set playing) or that playlist, straight to the clipboard. */
async function copyLink(key) {
  const t = resolve(key);
  if (!t) return;
  const url = t.list ? t.url : here + "#set/" + encodeURIComponent(t.set.id);
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: url });
    document.body.append(ta); ta.select();
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
  }
  toast(ok ? "link copied" : url);
}
let toastT = 0;
function toast(m) {
  let el = document.getElementById("toast");
  if (!el) { el = Object.assign(document.createElement("div"), { id: "toast", className: "toast" }); el.setAttribute("role", "status"); document.body.append(el); }
  el.textContent = m;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), 2200);
}
$("share-link").addEventListener("click", async () => {
  if (!target) return;
  const { url, title } = target;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ title, url }); return; }
    await navigator.clipboard.writeText(url);
    say("link copied");
  } catch (e) { if (e.name !== "AbortError") say(url); }
});
$("share-story").addEventListener("click", async () => {
  if (!target) return;
  const t = target, b = $("share-story");
  b.disabled = true;
  say("making the picture…");
  try {
    const { story } = await import("./story.js?v=20261023");
    const terrain = await (await fetch("terrain.json")).json();
    const o = { where: t.where, theme: root.dataset.tema, terrain };
    const blob = t.list
      ? await story({ artist: t.list.name, covers: t.list.sets.map((s) => s.cover).filter(Boolean) }, { ...o, about: [t.list.title, day(t.list.date)].filter(Boolean).join(", "), length: `${t.list.sets.length} recordings · ${total(t.list)}` })
      : await story(t.set, { ...o, about: [label(t.set), day(t.set.date)].filter(Boolean).join(", "), length: span(t.set.duration) });
    const file = new File([blob], `mixmix-${t.list ? t.list.id : t.set.id}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      say("");
      await navigator.share({ files: [file], title: t.title });
    } else {
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: file.name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      say("picture saved");
    }
  } catch (e) { say(e.name === "AbortError" ? "" : "that didn't work, try again"); }
  finally { b.disabled = false; }
});

// ---- The map: contour lines of the real hills around Cà de Monti, stacked in 3D ----
const T = await (await fetch("terrain.json")).json();
const N = T.n, Z = T.z, zmin = Math.min(...Z), zmax = Math.max(...Z);
const SIZE = 9;                                   // scene units across (~9 km)
const VERT = 1.6 / (zmax - zmin);                 // vertical exaggeration
const canvas = $("map");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
const css = getComputedStyle(document.documentElement), tone = (v) => new THREE.Color(css.getPropertyValue(v).trim());
renderer.setClearColor(0x000000, 0);              // transparent: the wordmark shows through
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const H = (v) => (v - zmin) * VERT;
const at = (i, j) => Z[i * N + j];
const P = (i, j) => [(j / (N - 1) - 0.5) * SIZE, (i / (N - 1) - 0.5) * SIZE];
/** Ground height (scene units) under a scene point, bilinear. */
function ground(x, z) {
  const j = (x / SIZE + 0.5) * (N - 1), i = (z / SIZE + 0.5) * (N - 1);
  const i0 = Math.max(0, Math.min(N - 2, Math.floor(i))), j0 = Math.max(0, Math.min(N - 2, Math.floor(j))), fi = i - i0, fj = j - j0;
  const v = at(i0, j0) * (1 - fi) * (1 - fj) + at(i0, j0 + 1) * (1 - fi) * fj + at(i0 + 1, j0) * fi * (1 - fj) + at(i0 + 1, j0 + 1) * fi * fj;
  return H(v);
}

// Marching squares: one isoline every 20 m, every 100 m darker. The minimal page (minimal.html):
// one every 40 m, lighter, and no antenna or rings.
const MINIMAL = !!window.MIXMIX_MINIMAL, STEP = MINIMAL ? 40 : 20;
const levels = [];
for (let v = Math.ceil(zmin / STEP) * STEP; v < zmax; v += STEP) {
  const pts = [];
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const c = [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)];
    const k4 = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]];
    const cross = [];
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      if ((a < v) !== (b < v)) {
        const t = (v - a) / (b - a), [ai, aj] = k4[k], [bi, bj] = k4[(k + 1) % 4];
        cross.push(P(ai + (bi - ai) * t, aj + (bj - aj) * t));
      }
    }
    for (let k = 0; k + 1 < cross.length; k += 2) pts.push(cross[k][0], 0, cross[k][1], cross[k + 1][0], 0, cross[k + 1][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const major = v % 100 === 0;
  const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: tone(major ? "--map-major" : "--map-minor"), transparent: true, opacity: major ? (MINIMAL ? 0.8 : 1) : (MINIMAL ? 0.4 : 0.7) }));
  line.position.y = H(v);
  line.userData.base = H(v);
  line.userData.major = major;
  scene.add(line);
  levels.push(line);
}

// ---- The antenna at Cà de Monti: a fine lattice mast, drawn in lines like the map ----
const [hx, hz] = P(N / 2, N / 2);
const base = ground(hx, hz);
const MAST = 0.17, ink = new THREE.LineBasicMaterial({ color: tone("--map-major") });
let glow = 1;                                       // on black the green rings need more light
retone = () => {
  glow = root.dataset.tema === "nero" ? 2.2 : 1;
  const c = getComputedStyle(root), col = (v) => new THREE.Color(c.getPropertyValue(v).trim());
  levels.forEach((l) => l.material.color.copy(col(l.userData.major ? "--map-major" : "--map-minor")));
  ink.color.copy(col("--map-major"));
  shade.color.copy(col("--map-minor"));
  wave.forEach((r) => r.material.color.copy(col("--map-ring")));
};
const mast = [];
const leg = (k, y) => { const r = 0.02 * (1 - (y / MAST) * 0.72), a = (k / 3) * Math.PI * 2 + 0.3; return [hx + Math.cos(a) * r, base + y, hz + Math.sin(a) * r]; };
const seg = (a, b) => mast.push(...a, ...b);
const STEPS = 7;
for (let s = 0; s < STEPS; s++) {
  const y0 = (s / STEPS) * MAST, y1 = ((s + 1) / STEPS) * MAST;
  for (let k = 0; k < 3; k++) {
    seg(leg(k, y0), leg(k, y1));                    // legs
    seg(leg(k, y1), leg((k + 1) % 3, y1));          // rings
    seg(leg(k, y0), leg((k + 1) % 3, y1));          // cross braces, zig-zag
  }
}
const top = [hx, base + MAST, hz];
seg(top, [hx, base + MAST + 0.05, hz]);             // whip
for (const [y, w] of [[0.016, 0.022], [0.032, 0.015]]) { // two dipoles
  seg([hx - w, base + MAST + y, hz], [hx + w, base + MAST + y, hz]);
  seg([hx, base + MAST + y, hz - w * 0.7], [hx, base + MAST + y, hz + w * 0.7]);
}
for (let k = 0; k < 3; k++) {                       // guy wires, anchored on the ground
  const a = (k / 3) * Math.PI * 2 + 0.3, x = hx + Math.cos(a) * 0.06, z = hz + Math.sin(a) * 0.06;
  seg(leg(k, MAST * 0.66), [x, Math.max(ground(x, z), base - 0.03), z]); // the slope falls away steeply: keep them short
}
const mastGeo = new THREE.BufferGeometry();
mastGeo.setAttribute("position", new THREE.Float32BufferAttribute(mast, 3));
// Trial page (prova-h.html): Habitat's H in stones instead of the antenna.
const STONES = !!window.MIXMIX_H, HH = 0.22;
const CLOSE = STONES && /[?&]vicino\b/.test(location.search) ? { a: +(location.search.match(/[?&]a=(-?[\d.]+)/)?.[1] ?? NaN) || (/[?&]a=0\b/.test(location.search) ? 0 : undefined), y: +(location.search.match(/[?&]y=(-?[\d.]+)/)?.[1] ?? NaN) || (/[?&]y=0\b/.test(location.search) ? 0 : undefined) } : null;
const TOP = STONES ? HH : MAST + 0.05;              // height of the object's top above the ground
const shade = new THREE.LineBasicMaterial({ color: tone("--map-minor") });
if (STONES) {
  const { stones } = await import("./stones.js");
  const fill = new THREE.MeshBasicMaterial({ color: tone("--ground"), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const h = await stones(THREE, { src: "logo.png", height: HH, lines: ink, minor: shade, fill });
  h.position.set(hx, base - 0.004, hz);
  h.rotation.y = 0.6;                               // its front faces where the camera starts
  scene.add(h);
} else if (!MINIMAL) scene.add(new THREE.LineSegments(mastGeo, ink));

// Transmission: thin green rings leaving the top of the mast, faster and brighter with the music.
const WAVES = 5, wave = [];
const circle = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2), 0, Math.sin((i / 128) * Math.PI * 2))));
for (let k = 0; k < (MINIMAL ? 0 : WAVES); k++) {
  const ring = new THREE.Line(circle, new THREE.LineBasicMaterial({ color: tone("--map-ring"), transparent: true, opacity: 0 }));
  ring.position.set(hx, base + TOP - 0.02, hz);
  ring.userData.phase = k / WAVES;
  scene.add(ring);
  wave.push(ring);
}

// Sound: the real spectrum (the files are on this site), each 20 m lifted by its own band.
let analyser = null, bins = null;
audio.addEventListener("play", () => {
  if (analyser) { analyser.context.resume(); return; }
  try {
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.9;
    bins = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    analyser.connect(ctx.destination);
  } catch { analyser = null; }
});

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

let visible = true;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
const t0 = performance.now();
let phase = 0, last = t0;
function frame(now) {
  retone();
requestAnimationFrame(frame);
  if (!visible || document.hidden) { last = now; return; }
  const t = (now - t0) / 1000, dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Seen from high up, close in: the hills fill the screen at every angle of the slow orbit.
  const ang = reduce ? 0.6 : 0.6 + t * 0.025;
  const wide = camera.aspect > 1;
  const dist = wide ? 3.3 : 3.0, lift = wide ? 3.1 : 4.4;
  if (camera.fov !== (wide ? 30 : 24)) { camera.fov = wide ? 30 : 24; camera.updateProjectionMatrix(); }
  camera.position.set(hx + Math.sin(ang) * dist, base + lift, hz + Math.cos(ang) * dist);
  camera.lookAt(hx, base + 0.1, hz);
  if (CLOSE) {                                      // trial page, ?vicino: the stones up close, turning
    const a2 = 0.6 + (CLOSE.a ?? t * 0.25);
    camera.position.set(hx + Math.sin(a2) * 0.75, base + HH * 0.5 + (CLOSE.y ?? 0.12), hz + Math.cos(a2) * 0.75);
    camera.lookAt(hx, base + HH * 0.5, hz);
  }
  const live = analyser && !audio.paused;
  if (live) analyser.getByteFrequencyData(bins);
  let level = 0;
  levels.forEach((l, k) => {
    const f = k / levels.length;
    const b = live ? bins[Math.floor(f * bins.length * 0.7)] / 255 : 0.04 * (0.5 + 0.5 * Math.sin(t * 0.8 - f * 9));
    level += b / levels.length;
    l.position.y = l.userData.base + (reduce ? 0 : b * 0.05 * (0.4 + f));   // a gentle sway: the user found 0.16 too much
  });
  // The rings: always a slow trickle; with music they run faster and stronger.
  phase += dt * (audio.paused ? 0.03 : 0.05 + level * 0.12);   // slow: a ring takes 15–30 s to cross the map
  wave.forEach((r) => {
    const p = (phase + r.userData.phase) % 1;
    const radius = 0.05 + p * (wide ? 2.6 : 2.0);
    r.scale.setScalar(radius);
    r.material.opacity = reduce ? 0 : Math.min(1, (1 - p) * (audio.paused ? 0.35 : 0.55 + level) * glow);
  });
  if (!CLOSE) place(); else camera.clearViewOffset();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// Keep the antenna in the free paper: below the wordmark, clear of the legend box, whatever the window.
const tip = new THREE.Vector3(hx, base + TOP, hz), foot = new THREE.Vector3(hx, base, hz);
const wordmark = document.querySelector(".wordmark"), box = $("air");
function place() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  camera.clearViewOffset();
  camera.updateMatrixWorld();
  const px = (v) => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h]; };
  const [tx, ty] = px(tip), [, fy] = px(foot);
  const below = wordmark.getBoundingClientRect().bottom + h * 0.06;   // birbi's ink hangs below its box
  const b = box.getBoundingClientRect();
  const wide = w > 760;
  // Free area: wide screens, right of the legend box; phones, between wordmark and box.
  const goalX = wide ? Math.max(b.right + (w - b.right) * 0.45, w * 0.62) : w * 0.5;
  const room = (wide ? h : b.top) - below - (fy - ty);
  const goalY = below + Math.max(0, room) * (wide ? 0.3 : 0.4);
  camera.setViewOffset(w, h, tx - goalX, ty - goalY, w, h);
}

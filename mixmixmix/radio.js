// The radio's programme, shared by the page and the admin. Two layers:
// - the loop: every set marked for the radio, in the order of sets.json, round and round since EPOCH,
//   so everyone who opens the page hears the same second;
// - the schedule: sets programmed for a date and time. A scheduled set plays from its start to its end
//   and cuts in over the loop, which carries on underneath (it keeps its clock) and comes back after.
export const EPOCH = Date.UTC(2026, 0, 1);

/** Schedule entries with their set and their start/end in ms, oldest first. Unknown sets are dropped. */
export function slots(sets, schedule = []) {
  return schedule
    .map((e) => ({ ...e, set: sets.find((s) => s.id === e.set), start: Date.parse(e.at) }))
    .filter((e) => e.set && e.set.duration > 0 && !isNaN(e.start))
    .map((e) => ({ ...e, end: e.start + e.set.duration * 1000 }))
    .sort((a, b) => a.start - b.start);
}

/** What is on air at `now`: { set, at (s into it), start, end (ms), slot (the schedule entry, or null) }. */
export function programme(sets, schedule, now = Date.now()) {
  const sl = slots(sets, schedule);
  const on = sl.find((e) => e.start <= now && now < e.end);
  if (on) return { set: on.set, at: (now - on.start) / 1000, start: on.start, end: on.end, slot: on };
  const loop = sets.filter((s) => s.radio !== false && s.duration > 0);
  if (!loop.length) {                                // nothing in rotation: silence until the next slot
    return null;
  }
  const total = loop.reduce((n, s) => n + s.duration, 0) * 1000;
  let t = (now - EPOCH) % total;
  if (t < 0) t += total;
  let i = 0;
  while (t >= loop[i].duration * 1000) { t -= loop[i].duration * 1000; i++; }
  const start = now - t, end = start + loop[i].duration * 1000;
  const cut = sl.find((e) => e.start > now && e.start < end);   // a scheduled set cuts this one short
  return { set: loop[i], at: t / 1000, start, end: cut ? cut.start : end, slot: null };
}

/** The next `n` things on air from `from`, each { set, start, end, slot }. */
export function upcoming(sets, schedule, from = Date.now(), n = 10) {
  const out = [];
  let t = from;
  for (let k = 0; k < n; k++) {
    let p = programme(sets, schedule, t);
    if (!p) {                                        // silence: jump to the next slot, if any
      const next = slots(sets, schedule).find((e) => e.start > t);
      if (!next) break;
      p = programme(sets, schedule, next.start);
    }
    out.push(p);
    t = p.end;
  }
  return out;
}

// Formulario → scheda Mixmix: i set della radio (caricare, modificare, ordinare), le playlist, il palinsesto.
// Pagina pubblica: habitattt.it/mixmixmix/. Parla con formulario-backend: /mixmix-admin/* (con il token del formulario) e /mixmix/state (pubblico).
// È un componente Alpine annidato nell'app: legge token e permessi dall'app (canWriteTab, logout).
document.addEventListener('alpine:init', () => {
    const TZ = 'Europe/Rome';
    const AUDIO_RE = /\.(mp3|m4a|aac|ogg|opus|wav|flac|aiff?)$/i, IMAGE_RE = /\.(jpe?g|png|webp|gif|tiff?)$/i, LOSSLESS_RE = /\.(wav|flac|aiff?)$/i;
    const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ms).map((p) => [p.type, p.value]));
    const offset = (ms) => { const p = parts(ms); return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; };
    /** "2026-10-24" + "21:00", ora italiana → ms. */
    const romeToMs = (day, time) => { const [y, m, d] = day.split('-').map(Number), [h, mi] = time.split(':').map(Number); const g = Date.UTC(y, m - 1, d, h, mi); return g - offset(g - offset(g)); };
    const today = () => { const p = parts(Date.now()); return `${p.year}-${p.month}-${p.day}`; };
    const base = (name) => name.replace(/\.[^.]+$/, '').toLowerCase();
    /** "03_Carolina_Martines-final.wav" → "Carolina Martines final": un inizio, da correggere nella riga. */
    const guessArtist = (name) => name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/^\s*\d{1,3}\s*[-.)\s]\s*/, '').replace(/\s+/g, ' ').trim();

    Alpine.data('mixmixAdmin', () => ({
        mx: { sets: [], playlists: [], schedule: [], disk: null },
        mxLoaded: false,
        mxError: '',
        mxRadio: null,                          // ../mixmixmix/radio.js: il programma della radio, uguale al player
        mxNow: Date.now(),
        mxNew: null,                            // il modulo "nuovo mix"
        mxEdit: null,                           // { id, ...campi, audio, cover }
        mxBulk: null,                           // più mix insieme
        mxPl: { name: '', title: '', date: '' },
        mxPlEdit: null,
        mxSched: { set: '', day: today(), time: '21:00' },
        mxMsg: '',

        // ---- Server ----
        mxHeaders(json) { return { 'Authorization': `Bearer ${localStorage.getItem('token')}`, ...(json ? { 'Content-Type': 'application/json' } : {}) }; },
        async mxApi(method, path, body) {
            const r = await fetch(`${BASE_URL}/mixmix-admin/${path}`, { method, headers: this.mxHeaders(!!body), body: body && JSON.stringify(body) });
            if (r.status === 401) { this.logout?.(); throw new Error('Sessione scaduta'); }
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `Errore ${r.status}`);
            return j;
        },
        /** Un file a /mixmix-admin/upload, con l'avanzamento: restituisce il token. */
        mxPut(file, progress) {
            return new Promise((resolve, reject) => {
                const x = new XMLHttpRequest(), fd = new FormData();
                fd.append('file', file);
                x.open('POST', `${BASE_URL}/mixmix-admin/upload`);
                x.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token')}`);
                x.upload.onprogress = (e) => e.lengthComputable && progress?.(e.loaded / e.total);
                x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(j.token) : reject(new Error(j.error || `Caricamento non riuscito (${x.status})`)); };
                x.onerror = () => reject(new Error('Il caricamento si è interrotto: controlla la connessione e riprova'));
                x.send(fd);
            });
        },
        async mxLoad() {
            this.mxError = '';
            try {
                this.mx = await this.mxApi('GET', 'state');
                this.mxLoaded = true;
                if (!this.mxRadio) this.mxRadio = await import('../mixmixmix/radio.js');
                if (!this.mxSched.set && this.mx.sets[0]) this.mxSched.set = this.mx.sets[0].id;
            } catch (e) { this.mxError = e.message; }
        },
        mxInit() { setInterval(() => { this.mxNow = Date.now(); }, 30000); },

        // ---- Formati ----
        mxSpan(s) { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; },
        mxWhen(ms) { return new Intl.DateTimeFormat('it-IT', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms); },
        mxClock(ms) { return new Intl.DateTimeFormat('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(ms); },
        mxGb(b) { return b == null ? '' : `${(b / 1024 ** 3).toFixed(b < 10 * 1024 ** 3 ? 1 : 0)} GB liberi`; },
        mxCover(s) { return s.cover ? `${BASE_URL}/mixmix/covers/${encodeURIComponent(s.cover)}.webp?v=${encodeURIComponent(s.added || '')}` : ''; },
        mxList(id) { return this.mx.playlists.find((p) => p.id === id); },
        mxSet(id) { return this.mx.sets.find((s) => s.id === id); },
        get mxUpcoming() { return this.mxRadio ? this.mxRadio.upcoming(this.mx.sets, this.mx.schedule, this.mxNow, 8) : []; },
        get mxFuture() { return this.mxRadio ? this.mxRadio.slots(this.mx.sets, this.mx.schedule).filter((e) => e.end > this.mxNow) : []; },

        // ---- Un mix nuovo ----
        mxOpenNew() { this.mxNew = { artist: '', date: today(), title: '', playlist: '', radio: true, description: '', audio: null, cover: null, progress: 0, msg: '', busy: false }; this.mxBulk = null; },
        async mxCollect(f) {
            const body = { artist: f.artist, date: f.date, title: f.title, playlist: f.playlist || null, radio: !!f.radio, description: f.description };
            if (f.cover) { f.msg = 'carico la copertina…'; body.cover = await this.mxPut(f.cover); }
            if (f.audio) {
                body.audio = await this.mxPut(f.audio, (p) => { f.progress = p; f.msg = `carico l'audio… ${Math.floor(p * 100)}%`; });
                f.msg = LOSSLESS_RE.test(f.audio.name) ? 'converto in mp3 e misuro la durata… (un minuto o due)' : 'misuro la durata…';
            }
            return body;
        },
        async mxCreate() {
            const f = this.mxNew;
            if (!f.audio) { f.msg = 'Scegli il file audio'; return; }
            if (!f.artist.trim()) { f.msg = "Serve l'artista"; return; }
            f.busy = true;
            try { const s = await this.mxApi('POST', 'sets', await this.mxCollect(f)); this.mxNew = null; this.mxMsg = `Aggiunto: ${s.artist}, ${this.mxSpan(s.duration)}`; await this.mxLoad(); }
            catch (e) { f.msg = e.message; }
            finally { if (this.mxNew) f.busy = false; }
        },

        // ---- Modificare un mix ----
        mxOpenEdit(s) {
            if (this.mxEdit?.id === s.id) { this.mxEdit = null; return; }
            this.mxEdit = { id: s.id, artist: s.artist, date: s.date, title: s.title || '', playlist: s.playlist || '', radio: s.radio !== false, description: s.description || '', audio: null, cover: null, progress: 0, msg: '', busy: false };
        },
        async mxSave() {
            const f = this.mxEdit;
            f.busy = true;
            try { await this.mxApi('PATCH', `sets/${encodeURIComponent(f.id)}`, await this.mxCollect(f)); this.mxEdit = null; await this.mxLoad(); }
            catch (e) { f.msg = e.message; f.busy = false; }
        },
        async mxDelete(s) {
            const n = this.mx.schedule.filter((e) => e.set === s.id).length;
            if (!confirm(`Eliminare “${s.artist}”? I file restano da parte sul server (cestino), non vengono cancellati.${n ? ` Viene tolto anche dal palinsesto (${n}).` : ''}`)) return;
            try { await this.mxApi('DELETE', `sets/${encodeURIComponent(s.id)}`); this.mxEdit = null; await this.mxLoad(); } catch (e) { alert(e.message); }
        },
        async mxMove(i, d) {
            const ids = this.mx.sets.map((s) => s.id), j = i + d;
            if (j < 0 || j >= ids.length) return;
            [ids[i], ids[j]] = [ids[j], ids[i]];
            try { await this.mxApi('POST', 'order', { ids }); } catch (e) { alert(e.message); }
            await this.mxLoad();
        },
        async mxToggleRadio(s, on) {
            try { await this.mxApi('PATCH', `sets/${encodeURIComponent(s.id)}`, { radio: on }); } catch (e) { alert(e.message); }
            await this.mxLoad();
        },

        // ---- Più mix insieme: una riga per file audio; data, playlist e radio in comune ----
        mxOpenBulk() { this.mxBulk = { rows: [], images: [], date: today(), playlist: '', newName: '', newEvent: '', radio: true, busy: false, msg: '', newList: null }; this.mxNew = null; },
        mxAddFiles(files) {
            const b = this.mxBulk;
            for (const f of files) if (IMAGE_RE.test(f.name) && !b.images.some((i) => i.name === f.name)) b.images.push(f);
            for (const f of files) {
                if (!AUDIO_RE.test(f.name) || b.rows.some((r) => r.audio.name === f.name && r.audio.size === f.size)) continue;
                b.rows.push({ key: Math.random().toString(36).slice(2), audio: f, coverName: '', artist: guessArtist(f.name), description: '', progress: 0, state: 'pronto', error: false, done: false, audioToken: null, coverToken: null });
            }
            for (const r of b.rows) if (!r.coverName) r.coverName = b.images.find((i) => base(i.name) === base(r.audio.name))?.name || '';
        },
        mxBulkMove(i, d) { const r = this.mxBulk.rows, j = i + d; if (j >= 0 && j < r.length) [r[i], r[j]] = [r[j], r[i]]; },
        async mxBulkGo() {
            const b = this.mxBulk, todo = b.rows.filter((r) => !r.done);
            if (!b.date) { b.msg = 'Scegli la data'; return; }
            const nameless = todo.find((r) => !r.artist.trim());
            if (nameless) { b.msg = `Manca l'artista per ${nameless.audio.name}`; return; }
            b.busy = true; b.msg = '';
            let ok = 0;
            try {
                let playlist = b.playlist || null;
                if (b.newName.trim()) {
                    if (!b.newList || b.newList.name !== b.newName.trim()) b.newList = await this.mxApi('POST', 'playlists', { name: b.newName.trim(), title: b.newEvent, date: b.date });
                    playlist = b.newList.id;
                }
                for (const [n, r] of todo.entries()) {
                    const tag = `${n + 1}/${todo.length}`;
                    let posting = false;
                    try {
                        r.error = false; r.progress = 0;
                        const cover = b.images.find((i) => i.name === r.coverName);
                        if (cover && !r.coverToken) { r.state = `${tag} · carico la copertina…`; r.coverToken = await this.mxPut(cover); }
                        if (!r.audioToken) r.audioToken = await this.mxPut(r.audio, (p) => { r.progress = p; r.state = `${tag} · carico l'audio… ${Math.floor(p * 100)}%`; });
                        r.progress = 1; r.state = LOSSLESS_RE.test(r.audio.name) ? `${tag} · converto in mp3 e misuro…` : `${tag} · misuro la durata…`;
                        posting = true;
                        const s = await this.mxApi('POST', 'sets', { artist: r.artist, date: b.date, playlist, radio: b.radio, description: r.description, audio: r.audioToken, cover: r.coverToken || undefined });
                        r.done = true; r.state = `pubblicato · ${this.mxSpan(s.duration)}`; ok++;
                    } catch (e) {
                        if (posting) { r.audioToken = null; r.coverToken = null; }   // rifiutato dal server: i file si ricaricano
                        r.error = true; r.progress = 0; r.state = e.message;
                    }
                }
            } catch (e) { b.msg = e.message; }
            b.busy = false;
            const failed = b.rows.filter((r) => r.error && !r.done).length;
            if (ok || failed) b.msg = failed ? `${ok} pubblicati, ${failed} no: correggi e premi di nuovo.` : `${ok} pubblicati, in fondo all'elenco qui sotto.`;
            await this.mxLoad();
        },

        // ---- Palinsesto ----
        async mxSchedule() {
            const f = this.mxSched;
            try {
                const at = romeToMs(f.day, f.time);
                await this.mxApi('POST', 'schedule', { set: f.set, at: new Date(at).toISOString() });
                this.mxMsg = `Programmato: ${this.mxSet(f.set)?.artist}, ${this.mxWhen(at)}`;
                await this.mxLoad();
            } catch (e) { alert(e.message); }
        },
        async mxUnschedule(id) { try { await this.mxApi('DELETE', `schedule/${id}`); await this.mxLoad(); } catch (e) { alert(e.message); } },

        // ---- Playlist ----
        async mxCreatePl() {
            try { const p = await this.mxApi('POST', 'playlists', this.mxPl); this.mxPl = { name: '', title: '', date: '' }; this.mxMsg = `Creata: ${p.name}. Aggiungi i mix dalla loro modifica.`; await this.mxLoad(); }
            catch (e) { alert(e.message); }
        },
        mxOpenPl(p) { this.mxPlEdit = this.mxPlEdit?.id === p.id ? null : { id: p.id, name: p.name, title: p.title || '', date: p.date || '' }; },
        async mxSavePl() {
            try { await this.mxApi('PATCH', `playlists/${encodeURIComponent(this.mxPlEdit.id)}`, this.mxPlEdit); this.mxPlEdit = null; await this.mxLoad(); } catch (e) { alert(e.message); }
        },
        async mxDeletePl(p) {
            if (!confirm(`Eliminare la playlist “${p.name}”? I suoi mix restano nell'archivio, fuori dalla playlist.`)) return;
            try { await this.mxApi('DELETE', `playlists/${encodeURIComponent(p.id)}`); this.mxPlEdit = null; await this.mxLoad(); } catch (e) { alert(e.message); }
        },
        mxCount(p) { const n = this.mx.sets.filter((s) => s.playlist === p.id); return `${n.length} mix${n.length ? ' · ' + this.mxSpan(n.reduce((a, s) => a + s.duration, 0)) : ''}`; },
    }));
});

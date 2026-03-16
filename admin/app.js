document.addEventListener('alpine:init', () => {
    Alpine.data('app', () => ({
        BASE_URL,
        token: localStorage.getItem('token') || '',
        view: 'expenses',
        editingMembership: null,
        chart: null,
        items: [],
        guests: [],
        allBookings: [],
        selectedGuest: null,
        guestHistory: [],
        editingItem: null,
        editingBooking: null,
        editingResidency: null,
        confirmModal: null,
        editingGuest: null,
        newGuestToggle: false,
        newGuestName: '',
        deletedMemberships: [],
        membershipRequestCount: 0,
        membershipConfirmedCount: 0,
        residencyApproval: null,
        residencyCount: 0,
        membershipTab: 'requests',
        filter: 'all',
        habitanteFilter: 'all',
        typeFilter: 'all',
        stats: { totalIn: 0, totalOut: 0, balance: 0 },
        loginData: { username: '', password: '' },

        // User management state
        currentUser: null,
        usersList: [],
        editingUser: null,

        get canWrite() {
            return this.currentUser && this.currentUser.role === 'admin';
        },

        get visibleTabs() {
            if (!this.currentUser) return [];
            const allTabs = ['expenses', 'guests', 'bookings', 'residency', 'membership'];
            if (this.currentUser.role === 'admin') return [...allTabs, 'users'];
            if (this.currentUser.role === 'reader') return allTabs;
            // reader_limited
            return (this.currentUser.allowedTabs || []);
        },

        async init() {
            if (this.token) {
                const ok = await this.fetchCurrentUser();
                if (ok) await this.fetchData();
            }
        },

        async fetchCurrentUser() {
            try {
                const res = await fetch(`${this.BASE_URL}/users/me`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (res.status === 401) { this.logout(); return false; }
                if (!res.ok) return false;
                this.currentUser = await res.json();
                // Ensure current view is allowed
                if (!this.visibleTabs.includes(this.view)) {
                    this.view = this.visibleTabs[0] || 'expenses';
                }
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        },

        showConfirm(message) {
            return new Promise(resolve => {
                this.confirmModal = { message, resolve };
            });
        },

        formatDate(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        },

        async setView(v) {
            if (!this.visibleTabs.includes(v)) {
                v = this.visibleTabs[0] || 'expenses';
            }
            this.view = v;
            this.selectedGuest = null;
            this.editingItem = null;
            this.editingBooking = null;
            this.editingResidency = null;
            this.editingGuest = null;
            this.editingUser = null;
            this.confirmModal = null;
            await this.fetchData();
        },

        async fetchData() {
            if (!this.token) return;
            try {
                if (this.view === 'users') {
                    await this.fetchUsers();
                    return;
                }

                const res = await fetch(`${this.BASE_URL}/${this.view}/`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (res.status === 401) return this.logout();
                const data = await res.json();
                this.items = Array.isArray(data) ? data : [];

                if (this.view === 'guests' || this.view === 'bookings') {
                    const resB = await fetch(`${this.BASE_URL}/bookings/`, { headers: { 'Authorization': `Bearer ${this.token}` } });
                    this.allBookings = await resB.json();
                }

                if (this.view === 'membership') {
                    const resD = await fetch(`${this.BASE_URL}/membership/bin`, {
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });
                    this.deletedMemberships = await resD.json();
                }

                if (this.view === 'expenses') {
                    this.updateStats();
                    this.$nextTick(() => this.renderChart());
                }

                // always refresh nav badge counts
                const [memRes, resRes] = await Promise.all([
                    fetch(`${this.BASE_URL}/membership/`, { headers: { 'Authorization': `Bearer ${this.token}` } }),
                    fetch(`${this.BASE_URL}/residency/`, { headers: { 'Authorization': `Bearer ${this.token}` } })
                ]);
                const memData = await memRes.json();
                const resData = await resRes.json();
                this.membershipRequestCount = Array.isArray(memData) ? memData.filter(m => !m.confirmed).length : 0;
                this.membershipConfirmedCount = Array.isArray(memData) ? memData.filter(m => m.confirmed).length : 0;
                this.residencyCount = Array.isArray(resData) ? resData.length : 0;
            } catch (e) { console.error(e); }
        },

        get filteredMemberships() {
            if (this.view !== 'membership') return [];
            return this.items.filter(m =>
                this.membershipTab === 'confirmed' ? m.confirmed : !m.confirmed
            );
        },

        get filteredItems() {
            if (this.view !== 'expenses') return this.items;

            return this.items.filter(i => {
                const isExit = String(i.isExit) === 'true';

                let matchType = true;
                if (this.filter === 'in') matchType = !isExit;
                if (this.filter === 'out') matchType = isExit;

                if (this.filter !== 'out') return matchType && (this.typeFilter === 'all' || i.expenseType === this.typeFilter);

                let matchHabitante = true;
                if (this.habitanteFilter !== 'all') {
                    if (this.habitanteFilter === 'habitat') {
                        matchHabitante = i.payerType === 'habitat';
                    } else {
                        matchHabitante = i.payerType === 'habitante' && i.specificHabitante === this.habitanteFilter;
                    }
                }

                let matchExpenseType = this.typeFilter === 'all' || i.expenseType === this.typeFilter;

                return matchType && matchHabitante && matchExpenseType;
            });
        },

        updateStats() {
            let inc = 0, out = 0;
            this.items.forEach(i => {
                const val = parseFloat(i.amount) || 0;
                String(i.isExit) === 'true' ? out += val : inc += val;
            });
            this.stats = { totalIn: inc.toFixed(2), totalOut: out.toFixed(2), balance: (inc - out).toFixed(2) };
        },

        renderChart() {
            const canvas = document.getElementById('expenseChart');
            if (!canvas || this.view !== 'expenses' || this.items.length === 0) return;
            const sorted = [...this.items].sort((a, b) => new Date(a.date) - new Date(b.date));

            // 1. Aggregate daily net amounts
            const dailyNet = {};
            sorted.forEach(i => {
                const day = i.date.split('T')[0];
                const val = String(i.isExit) === 'true' ? -i.amount : i.amount;
                dailyNet[day] = (dailyNet[day] || 0) + val;
            });

            // 2. Build cumulative running balance
            const days = Object.keys(dailyNet).sort();
            let running = 0;
            const labels = [];
            const data = [];
            days.forEach(day => {
                running += dailyNet[day];
                labels.push(this.formatDate(day));
                data.push(running);
            });

            if (this.chart) this.chart.destroy();
            this.chart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{ label: 'Saldo', data, borderColor: '#000', tension: 0.1, fill: false }]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { font: { size: 9 } } } } }
            });
        },

        async selectGuest(guest) {
            try {
                this.selectedGuest = guest;
                const res = await fetch(`${this.BASE_URL}/bookings/`, { headers: { 'Authorization': `Bearer ${this.token}` } });
                if (!res.ok) throw new Error("Errore caricamento prenotazioni");
                const allB = await res.json();
                this.guestHistory = allB.filter(b => (b.guest?.id || b.guest) === guest.id);
            } catch (e) { alert(e.message); }
        },

        isGuestPresent(guestId) {
            const today = new Date().setHours(0, 0, 0, 0);
            return this.allBookings.some(b => {
                const gId = b.guest?.id || b.guest;
                return gId === guestId && today >= new Date(b.checkIn).setHours(0, 0, 0, 0) && today <= new Date(b.checkOut).setHours(0, 0, 0, 0);
            });
        },

        getBookingStatus(b) {
            const today = new Date().setHours(0, 0, 0, 0);
            const start = new Date(b.checkIn).setHours(0, 0, 0, 0);
            const end = new Date(b.checkOut).setHours(0, 0, 0, 0);
            if (today < start) return 'Futuro';
            if (today > end) return 'Concluso';
            return 'In corso';
        },

        openCreateGuest() {
            this.editingGuest = { name: '', email: '', phone: '', isConfirmed: false };
        },

        async saveGuest() {
            try {
                const isUpdate = !!this.editingGuest.id;
                const url = isUpdate ? `${this.BASE_URL}/guests/${this.editingGuest.id}` : `${this.BASE_URL}/guests/`;
                const res = await fetch(url, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(this.editingGuest)
                });
                if (!res.ok) throw new Error("Errore salvataggio ospite");
                const saved = await res.json();
                if (isUpdate) this.selectedGuest = saved;
                this.editingGuest = null;
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async saveData() {
            try {
                const isUpdate = !!this.editingItem.id;
                const payload = {
                    ...this.editingItem,
                    amount: Number(this.editingItem.amount),
                    isExit: String(this.editingItem.isExit) === 'true',
                    category: String(this.editingItem.isExit) === 'true' ? 'uscita' : 'entrata'
                };
                const res = await fetch(isUpdate ? `${this.BASE_URL}/expenses/${this.editingItem.id}` : `${this.BASE_URL}/expenses/`, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Errore salvataggio spesa");
                this.editingItem = null;
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async saveBooking() {
            try {
                let guestId = this.editingBooking.guest;
                if (this.newGuestToggle && this.newGuestName) {
                    const resG = await fetch(`${this.BASE_URL}/guests/`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                        body: JSON.stringify({ name: this.newGuestName, isConfirmed: false })
                    });
                    if (!resG.ok) throw new Error("Errore creazione ospite");
                    const newG = await resG.json();
                    guestId = newG.id;
                }
                const isUpdate = !!this.editingBooking.id;
                const res = await fetch(isUpdate ? `${this.BASE_URL}/bookings/${this.editingBooking.id}` : `${this.BASE_URL}/bookings/`, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({ ...this.editingBooking, guest: guestId })
                });
                if (!res.ok) throw new Error("Errore salvataggio prenotazione");
                this.editingBooking = null;
                this.newGuestName = '';
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async login() {
            const res = await fetch(`${this.BASE_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.loginData) });
            const d = await res.json();
            if (d.token) {
                this.token = d.token;
                localStorage.setItem('token', d.token);
                await this.fetchCurrentUser();
                await this.fetchData();
            }
            else { alert("Login fallito: credenziali non valide"); }
        },

        async logout() {
            try {
                await fetch(`${this.BASE_URL}/auth/logout`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
            } catch (e) { /* logout should always succeed client-side */ }
            this.token = '';
            this.currentUser = null;
            localStorage.removeItem('token');
        },

        openCreate() {
            this.editingItem = {
                title: '', description: '', amount: 0, date: new Date().toISOString().split('T')[0],
                isExit: true, receiptType: 'nessuno', payerType: 'habitat', paymentMethod: 'cash',
                isRepeatable: false, repeatInterval: 'monthly', expenseType: ''
            };
        },

        openEdit(item) {
            this.editingItem = { ...item, isExit: String(item.isExit) === 'true', date: item.date.split('T')[0] };
        },

        async openCreateBooking() {
            const res = await fetch(`${this.BASE_URL}/guests/`, { headers: { 'Authorization': `Bearer ${this.token}` } });
            this.guests = await res.json();
            this.newGuestToggle = false;
            this.editingBooking = {
                guest: '',
                checkIn: new Date().toISOString().split('T')[0],
                checkOut: new Date().toISOString().split('T')[0],
                feedback: '',
                room: 'da assegnare'
            };
        },

        async openEditBooking(b) {
            const res = await fetch(`${this.BASE_URL}/guests/`, { headers: { 'Authorization': `Bearer ${this.token}` } });
            this.guests = await res.json();

            this.newGuestToggle = false;

            const guestId = b.guest?.id || b.guest;

            this.editingBooking = {
                ...b,
                checkIn: b.checkIn.split('T')[0],
                checkOut: b.checkOut.split('T')[0],
                guest: guestId,
                feedback: b.feedback || ''
            };
        },

        async startResidencyApproval(r) {
            try {
                const resB = await fetch(`${this.BASE_URL}/bookings/`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                const allBookings = await resB.json();
                const allRooms = ['ex poni', 'monolocale', 'camerata'];
                const from = new Date(r.fromDate);
                const to = new Date(r.toDate);
                const availableRooms = allRooms.filter(room =>
                    !allBookings.some(b =>
                        b.room === room &&
                        new Date(b.checkIn) < to &&
                        new Date(b.checkOut) > from
                    )
                );
                const emailSubject = `Conferma residenza - Habitat`;
                const emailBody = `Ciao ${r.name},\n\nsiamo felici di comunicarti che la tua richiesta di residenza dal ${this.formatDate(r.fromDate)} al ${this.formatDate(r.toDate)} è stata approvata!\n\nA presto,\nHabitat`;
                this.residencyApproval = { residency: r, room: '', emailSubject, emailBody, availableRooms };
            } catch (e) { alert(e.message); }
        },

        async confirmResidency() {
            const { residency, room, emailSubject, emailBody } = this.residencyApproval;
            try {
                const res = await fetch(`${this.BASE_URL}/residency/${residency.id}/approve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({ room, emailSubject, emailBody })
                });
                if (!res.ok) throw new Error("Errore approvazione residenza");
                this.residencyApproval = null;
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        openCreateResidency() {
            this.editingResidency = { name: '', email: '', fromDate: '', toDate: '', proposal: '' };
        },

        async saveResidency() {
            try {
                const isUpdate = !!this.editingResidency.id;
                const url = isUpdate ? `${this.BASE_URL}/residency/${this.editingResidency.id}` : `${this.BASE_URL}/residency/`;
                await fetch(url, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(this.editingResidency)
                });
                this.editingResidency = null;
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async confirmMembership(m) {
            if (!await this.showConfirm("Confermare tesseramento?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/membership/${m.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({ confirmed: true })
                });
                if (!res.ok) throw new Error("Errore conferma tesseramento");
                const paymentMap = { HabitatPaypal: 'paypal', HabitatIban: 'iban', DistrettoPaypal: 'paypal', DistrettoIban: 'iban', Cash: 'cash' };
                const resE = await fetch(`${this.BASE_URL}/expenses/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({
                        title: `Tessera ${m.surname} ${m.name}`,
                        amount: 10,
                        date: new Date().toISOString().split('T')[0],
                        isExit: false,
                        category: 'entrata',
                        paymentMethod: paymentMap[m.paymentMethod] || 'cash',
                        expenseType: 'tessera'
                    })
                });
                if (!resE.ok) throw new Error("Errore creazione spesa tessera");
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async restoreMembership(m) {
            if (!await this.showConfirm("Ripristinare questo socio?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/membership/${m.id}/restore`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore ripristino");
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async deleteItem(id) {
            if (await this.showConfirm("Eliminare?")) {
                try {
                    const res = await fetch(`${this.BASE_URL}/${this.view}/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${this.token}` } });
                    if (!res.ok) throw new Error("Errore eliminazione");
                    await this.fetchData();
                } catch (e) { alert(e.message); }
            }
        },

        // ── User Management ──

        async fetchUsers() {
            try {
                const res = await fetch(`${this.BASE_URL}/users/`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore caricamento utenti");
                this.usersList = await res.json();
            } catch (e) { alert(e.message); }
        },

        openCreateUser() {
            this.editingUser = { username: '', password: '', email: '', role: 'reader', allowedTabs: [], active: true };
        },

        openEditUser(user) {
            this.editingUser = { ...user, password: '', allowedTabs: user.allowedTabs || [] };
        },

        toggleTab(tab) {
            if (!this.editingUser) return;
            const idx = this.editingUser.allowedTabs.indexOf(tab);
            if (idx === -1) {
                this.editingUser.allowedTabs.push(tab);
            } else {
                this.editingUser.allowedTabs.splice(idx, 1);
            }
        },

        async saveUser() {
            try {
                const isUpdate = !!this.editingUser.id;
                const payload = { ...this.editingUser };
                // Don't send empty password on update
                if (isUpdate && !payload.password) delete payload.password;
                const url = isUpdate ? `${this.BASE_URL}/users/${this.editingUser.id}` : `${this.BASE_URL}/users/`;
                const res = await fetch(url, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || "Errore salvataggio utente");
                }
                this.editingUser = null;
                await this.fetchUsers();
            } catch (e) { alert(e.message); }
        },

        async deleteUser(id) {
            if (!await this.showConfirm("Eliminare questo utente?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/users/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || "Errore eliminazione utente");
                }
                await this.fetchUsers();
            } catch (e) { alert(e.message); }
        }
    }));
});

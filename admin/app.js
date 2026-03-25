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
        deletedBookings: [],
        deletedResidencies: [],
        deletedFestivalTickets: [],
        festivalTickets: [],
        festivalTicketCount: 0,
        festivalConfirmedCount: 0,
        festivalApproval: null,
        festivalTab: 'tickets',
        plannerVenues: [],
        plannerActs: [],
        plannerSelectedDay: '2026-07-16',
        editingAct: null,
        editingVenue: null,
        showVenueManager: false,
        newVenueName: '',
        volunteers: [],
        editingVolunteer: null,
        timelineDeadlines: [],
        editingDeadline: null,
        timelineStart: '2026-03-19',
        timelineEnd: '2026-07-16',
        plannerDays: [
            { value: '2026-07-16', label: 'Gio 16', startHour: 8, endHour: 8 },
            { value: '2026-07-17', label: 'Ven 17', startHour: 8, endHour: 8 },
            { value: '2026-07-18', label: 'Sab 18', startHour: 8, endHour: 8 },
            { value: '2026-07-19', label: 'Dom 19', startHour: 8, endHour: 8 },
            { value: '2026-07-20', label: 'Lun 20', startHour: 8, endHour: 8 },
        ],
        membershipRequestCount: 0,
        membershipConfirmedCount: 0,
        checkoutModal: null,
        proposalModal: null,
        residencyApproval: null,
        residencyRejection: null,
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

        // Calendar state
        editingCalendarEvent: null,
        calendarInstance: null,

        // Telegram state
        telegramChats: [],
        telegramSettings: {},
        editingChat: null,
        digestPreview: null,
        digestSending: false,

        canWriteTab(tab) {
            if (!this.currentUser) return false;
            if (this.currentUser.role === 'admin') return true;
            if (tab === 'users' || tab === 'telegram') return false;
            const allowed = this.currentUser.allowedWriteTabs || [];
            return allowed.includes(tab);
        },

        get canWrite() {
            const tab = this.view === 'festival' ? 'festival' : this.view;
            return this.canWriteTab(tab);
        },

        get visibleTabs() {
            if (!this.currentUser) return [];
            const allTabs = ['expenses', 'guests', 'bookings', 'residency', 'membership', 'festival', 'calendar'];
            if (this.currentUser.role === 'admin') return [...allTabs, 'users', 'telegram'];
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
            this.festivalApproval = null;
            this.editingAct = null;
            this.editingVenue = null;
            this.showVenueManager = false;
            this.editingVolunteer = null;
            this.editingDeadline = null;
            this.editingCalendarEvent = null;
            this.editingChat = null;
            this.digestPreview = null;
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

                if (this.view === 'telegram') {
                    await this.fetchTelegramData();
                    return;
                }

                if (this.view === 'calendar') {
                    this.$nextTick(() => this.initCalendar());
                    return;
                }

                if (this.view === 'festival') {
                    const [ticketsRes, binRes] = await Promise.all([
                        fetch(`${this.BASE_URL}/festival/`, { headers: { 'Authorization': `Bearer ${this.token}` } }),
                        fetch(`${this.BASE_URL}/festival/bin`, { headers: { 'Authorization': `Bearer ${this.token}` } })
                    ]);
                    if (ticketsRes.status === 401) return this.logout();
                    this.festivalTickets = await ticketsRes.json();
                    this.deletedFestivalTickets = await binRes.json();
                    if (this.festivalTab === 'planner') {
                        await this.fetchPlannerData();
                    }
                    if (this.festivalTab === 'volunteers') {
                        await this.fetchVolunteers();
                    }
                    if (this.festivalTab === 'timeline') {
                        await this.fetchTimeline();
                    }
                    this.items = [];
                } else {
                    const res = await fetch(`${this.BASE_URL}/${this.view}/`, {
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });
                    if (res.status === 401) return this.logout();
                    const data = await res.json();
                    this.items = Array.isArray(data) ? data : [];
                }

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

                if (this.view === 'bookings') {
                    const resD = await fetch(`${this.BASE_URL}/bookings/bin`, {
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });
                    this.deletedBookings = await resD.json();
                }

                if (this.view === 'residency') {
                    const resD = await fetch(`${this.BASE_URL}/residency/bin`, {
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });
                    this.deletedResidencies = await resD.json();
                }

                if (this.view === 'expenses') {
                    this.updateStats();
                    this.$nextTick(() => this.renderChart());
                }

                // always refresh nav badge counts
                const [memRes, resRes, festRes] = await Promise.all([
                    fetch(`${this.BASE_URL}/membership/`, { headers: { 'Authorization': `Bearer ${this.token}` } }),
                    fetch(`${this.BASE_URL}/residency/`, { headers: { 'Authorization': `Bearer ${this.token}` } }),
                    fetch(`${this.BASE_URL}/festival/`, { headers: { 'Authorization': `Bearer ${this.token}` } })
                ]);
                const memData = await memRes.json();
                const resData = await resRes.json();
                const festData = await festRes.json();
                this.membershipRequestCount = Array.isArray(memData) ? memData.filter(m => !m.confirmed).length : 0;
                this.membershipConfirmedCount = Array.isArray(memData) ? memData.filter(m => m.confirmed).length : 0;
                this.residencyCount = Array.isArray(resData) ? resData.length : 0;
                this.festivalTicketCount = Array.isArray(festData) ? festData.length : 0;
                this.festivalConfirmedCount = Array.isArray(festData) ? festData.filter(t => t.confirmed).length : 0;
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

        get plannerTimeSlots() {
            const day = this.plannerDays.find(d => d.value === this.plannerSelectedDay);
            if (!day) return [];
            const slots = [];
            const addSlot = (hour) => {
                const label = `${String(hour).padStart(2, '0')}:00`;
                slots.push({ value: label, label, hour });
            };
            if (day.endHour === day.startHour) {
                for (let i = 0; i < 24; i++) {
                    const h = (day.startHour + i) % 24;
                    addSlot(h);
                }
            } else if (day.endHour < day.startHour) {
                for (let h = day.startHour; h <= 23; h++) addSlot(h);
                for (let h = 0; h < day.endHour; h++) addSlot(h);
            } else {
                for (let h = day.startHour; h < day.endHour; h++) addSlot(h);
            }
            return slots;
        },

        get scheduledActs() {
            if (!Array.isArray(this.plannerActs)) return [];
            return this.plannerActs.filter(a =>
                a.day === this.plannerSelectedDay &&
                a.venueId &&
                a.startTime &&
                a.endTime
            );
        },

        get unscheduledActs() {
            if (!Array.isArray(this.plannerActs)) return [];
            return this.plannerActs.filter(a =>
                !a.day || !a.venueId || !a.startTime || !a.endTime
            );
        },

        get confirmedActsBudget() {
            if (!Array.isArray(this.plannerActs)) return 0;
            return this.plannerActs.reduce((sum, act) => {
                if (act.status !== 'confirmed') return sum;
                return sum + (parseFloat(act.price) || 0);
            }, 0);
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

        async checkinGuest(bookingId) {
            if (!await this.showConfirm("Confermare il CHECK-IN?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/bookings/${bookingId}/checkin`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || "Errore check-in");
                }
                if (this.selectedGuest) await this.selectGuest(this.selectedGuest);
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async openCheckout(bookingId) {
            try {
                const res = await fetch(`${this.BASE_URL}/bookings/${bookingId}/invoice`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore caricamento invoice");
                const invoice = await res.json();
                const booking = this.guestHistory.find(b => b.id === bookingId)
                    || this.items.find(b => b.id === bookingId);
                this.checkoutModal = {
                    booking,
                    invoice,
                    paymentMethod: 'cash',
                    guestName: booking?.guest?.name || this.selectedGuest?.name || 'Ospite',
                    customAmount: invoice.totalAmount || 0
                };
            } catch (e) { alert(e.message); }
        },

        async confirmCheckout() {
            if (!this.checkoutModal) return;
            try {
                const res = await fetch(`${this.BASE_URL}/bookings/${this.checkoutModal.booking.id}/checkout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({ paymentMethod: this.checkoutModal.paymentMethod, totalAmount: this.checkoutModal.customAmount })
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || "Errore checkout");
                }
                this.checkoutModal = null;
                if (this.selectedGuest) await this.selectGuest(this.selectedGuest);
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        getGuestStatusLabel(status) {
            const labels = { standby: 'In attesa', in_progress: 'In corso', checkout: 'Check-out completato' };
            return labels[status] || status;
        },

        getGuestStatusColor(status) {
            const colors = { standby: '#999', in_progress: '#2c7a7b', checkout: 'green' };
            return colors[status] || '#000';
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
            if (!this.editingGuest.name?.trim()) {
                alert('Il nome è obbligatorio');
                return;
            }
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
            if (!this.editingItem.title?.trim()) {
                alert('Il titolo è obbligatorio');
                return;
            }
            if (!this.editingItem.amount || Number(this.editingItem.amount) <= 0) {
                alert('L\'importo deve essere maggiore di 0');
                return;
            }
            if (!this.editingItem.date) {
                alert('La data è obbligatoria');
                return;
            }
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
            if (!this.newGuestToggle && !this.editingBooking.guest) {
                alert('Seleziona un ospite');
                return;
            }
            if (this.newGuestToggle && !this.newGuestName?.trim()) {
                alert('Inserisci il nome del nuovo ospite');
                return;
            }
            if (!this.editingBooking.checkIn || !this.editingBooking.checkOut) {
                alert('Le date di check-in e check-out sono obbligatorie');
                return;
            }
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
                const [resB, resT] = await Promise.all([
                    fetch(`${this.BASE_URL}/bookings/`, {
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    }),
                    fetch(`${this.BASE_URL}/residency/${r.id}/email-template?lang=${r.language || 'it'}`, {
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    })
                ]);
                const allBookings = await resB.json();
                const { subject: emailSubject, body: emailBody } = await resT.json();
                const allRooms = ['monolocale', 'ex poni', 'ex ronco', 'cameratina', 'secondo piano', 'camerata'];
                const from = new Date(r.fromDate);
                const to = new Date(r.toDate);
                const availableRooms = allRooms.filter(room =>
                    !allBookings.some(b =>
                        b.room === room &&
                        new Date(b.checkIn) < to &&
                        new Date(b.checkOut) > from
                    )
                );
                this.residencyApproval = {
                    residency: r,
                    room: '',
                    emailSubject,
                    emailBody,
                    availableRooms,
                    allRooms
                };
            } catch (e) { alert(e.message); }
        },

        async confirmResidency() {
            const { residency, room, emailSubject, emailBody } = this.residencyApproval;
            if (!room) {
                alert('Seleziona una stanza prima di confermare');
                return;
            }
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

        async startResidencyRejection(r) {
            try {
                const res = await fetch(`${this.BASE_URL}/residency/${r.id}/email-template?lang=${r.language || 'it'}&type=rejection`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                const { subject: emailSubject, body: emailBody } = await res.json();
                this.residencyRejection = { residency: r, emailSubject, emailBody };
            } catch (e) { alert(e.message); }
        },

        async confirmRejection() {
            const { residency, emailSubject, emailBody } = this.residencyRejection;
            try {
                const res = await fetch(`${this.BASE_URL}/residency/${residency.id}/reject`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({ emailSubject, emailBody })
                });
                if (!res.ok) throw new Error("Errore rifiuto residenza");
                this.residencyRejection = null;
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        openCreateResidency() {
            this.editingResidency = { name: '', email: '', fromDate: '', toDate: '', proposal: '' };
        },

        async saveResidency() {
            if (!this.editingResidency.name?.trim()) {
                alert('Il nome è obbligatorio');
                return;
            }
            if (!this.editingResidency.fromDate || !this.editingResidency.toDate) {
                alert('Le date sono obbligatorie');
                return;
            }
            if (!this.editingResidency.proposal?.trim()) {
                alert('La proposta è obbligatoria');
                return;
            }
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
                const habitatMethods = ['HabitatPaypal', 'HabitatIban', 'CashHabitat'];
                if (habitatMethods.includes(m.paymentMethod)) {
                    const paymentMap = { HabitatPaypal: 'paypal', HabitatIban: 'iban', CashHabitat: 'cash' };
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
                }
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

        async restoreBooking(b) {
            if (!await this.showConfirm("Ripristinare questa prenotazione?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/bookings/${b.id}/restore`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore ripristino");
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async restoreResidency(r) {
            if (!await this.showConfirm("Ripristinare questa richiesta?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/residency/${r.id}/restore`, {
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

        // ── Festival ──

        async switchFestivalTab(tab) {
            this.festivalTab = tab;
            if (tab === 'planner') {
                await this.fetchPlannerData();
            }
            if (tab === 'volunteers') {
                await this.fetchVolunteers();
            }
            if (tab === 'timeline') {
                await this.fetchTimeline();
            }
        },

        async fetchTimeline() {
            try {
                const res = await fetch(`${this.BASE_URL}/festival/timeline`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (res.status === 401) return this.logout();
                this.timelineDeadlines = await res.json();
            } catch (e) { console.error(e); }
        },

        openCreateDeadline() {
            this.editingDeadline = {
                title: '',
                date: this.timelineStart,
                notes: ''
            };
        },

        openEditDeadline(d) {
            this.editingDeadline = { ...d };
        },

        async saveDeadline() {
            if (!this.editingDeadline?.title?.trim()) {
                alert('Il titolo è obbligatorio');
                return;
            }
            if (!this.editingDeadline?.date) {
                alert('La data è obbligatoria');
                return;
            }
            try {
                const isUpdate = !!this.editingDeadline.id;
                const url = isUpdate
                    ? `${this.BASE_URL}/festival/timeline/${this.editingDeadline.id}`
                    : `${this.BASE_URL}/festival/timeline`;
                const payload = {
                    title: this.editingDeadline.title,
                    date: this.editingDeadline.date,
                    notes: this.editingDeadline.notes
                };
                const res = await fetch(url, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Errore salvataggio scadenza");
                this.editingDeadline = null;
                await this.fetchTimeline();
            } catch (e) { alert(e.message); }
        },

        async deleteDeadline(id) {
            if (!await this.showConfirm("Eliminare questa scadenza?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/festival/timeline/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore eliminazione scadenza");
                await this.fetchTimeline();
            } catch (e) { alert(e.message); }
        },

        timelinePosition(dateStr) {
            if (!dateStr) return 0;
            const start = new Date(this.timelineStart).getTime();
            const end = new Date(this.timelineEnd).getTime();
            const cur = new Date(dateStr).getTime();
            if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(cur) || end <= start) return 0;
            const clamped = Math.max(start, Math.min(cur, end));
            const pct = ((clamped - start) / (end - start)) * 100;
            return Math.max(0, Math.min(100, pct));
        },

        get timelineTodayPosition() {
            const todayStr = new Date().toISOString().split('T')[0];
            return this.timelinePosition(todayStr);
        },

        async fetchVolunteers() {
            try {
                const res = await fetch(`${this.BASE_URL}/festival/volunteers`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (res.status === 401) return this.logout();
                this.volunteers = await res.json();
            } catch (e) { console.error(e); }
        },

        openCreateVolunteer() {
            this.editingVolunteer = {
                name: '',
                email: '',
                role: '',
                availability: '',
                notes: '',
                tasksText: ''
            };
        },

        openEditVolunteer(v) {
            const tasksText = Array.isArray(v.tasks) ? v.tasks.map(t => t.task).join(', ') : '';
            this.editingVolunteer = {
                ...v,
                tasksText
            };
        },

        async saveVolunteer() {
            if (!this.editingVolunteer?.name?.trim()) {
                alert('Il nome è obbligatorio');
                return;
            }
            try {
                const isUpdate = !!this.editingVolunteer.id;
                const url = isUpdate
                    ? `${this.BASE_URL}/festival/volunteers/${this.editingVolunteer.id}`
                    : `${this.BASE_URL}/festival/volunteers`;
                const payload = {
                    name: this.editingVolunteer.name,
                    email: this.editingVolunteer.email,
                    role: this.editingVolunteer.role,
                    availability: this.editingVolunteer.availability,
                    notes: this.editingVolunteer.notes,
                    tasks: this.editingVolunteer.tasksText
                        ? this.editingVolunteer.tasksText.split(',').map(t => t.trim()).filter(Boolean)
                        : []
                };
                const res = await fetch(url, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Errore salvataggio volontario");
                this.editingVolunteer = null;
                await this.fetchVolunteers();
            } catch (e) { alert(e.message); }
        },

        async deleteVolunteer(id) {
            if (!await this.showConfirm("Eliminare questo volontario?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/festival/volunteers/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore eliminazione volontario");
                await this.fetchVolunteers();
            } catch (e) { alert(e.message); }
        },

        async fetchPlannerData() {
            try {
                const [venuesRes, actsRes] = await Promise.all([
                    fetch(`${this.BASE_URL}/festival/planner/venues`, { headers: { 'Authorization': `Bearer ${this.token}` } }),
                    fetch(`${this.BASE_URL}/festival/planner/acts`, { headers: { 'Authorization': `Bearer ${this.token}` } })
                ]);
                if (venuesRes.status === 401 || actsRes.status === 401) return this.logout();
                this.plannerVenues = await venuesRes.json();
                this.plannerActs = await actsRes.json();
            } catch (e) { console.error(e); }
        },

        openCreateVenue() {
            this.editingVenue = { name: '', sortOrder: 0 };
        },

        openEditVenue(v) {
            this.editingVenue = { ...v };
        },

        async saveVenue() {
            if (!this.editingVenue?.name?.trim()) {
                alert('Il nome è obbligatorio');
                return;
            }
            try {
                const isUpdate = !!this.editingVenue.id;
                const url = isUpdate
                    ? `${this.BASE_URL}/festival/planner/venues/${this.editingVenue.id}`
                    : `${this.BASE_URL}/festival/planner/venues`;
                const res = await fetch(url, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({
                        name: this.editingVenue.name,
                        sortOrder: this.editingVenue.sortOrder
                    })
                });
                if (!res.ok) throw new Error("Errore salvataggio venue");
                this.editingVenue = null;
                await this.fetchPlannerData();
            } catch (e) { alert(e.message); }
        },

        async deleteVenue(id) {
            if (!await this.showConfirm("Eliminare questa venue?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/festival/planner/venues/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore eliminazione venue");
                await this.fetchPlannerData();
            } catch (e) { alert(e.message); }
        },

        async createQuickVenue() {
            if (!this.newVenueName.trim()) return;
            try {
                const res = await fetch(`${this.BASE_URL}/festival/planner/venues`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({ name: this.newVenueName, sortOrder: this.plannerVenues.length })
                });
                if (!res.ok) throw new Error("Errore creazione venue");
                this.newVenueName = '';
                await this.fetchPlannerData();
            } catch (e) { alert(e.message); }
        },

        openCreateAct() {
            this.editingAct = {
                title: '',
                description: '',
                status: 'draft',
                category: 'other',
                venueId: null,
                day: this.plannerSelectedDay,
                startTime: '',
                endTime: '',
                price: 0,
            };
        },

        openEditAct(act) {
            this.editingAct = {
                ...act,
                venueId: act.venueId || act.venue?.id || null,
            };
            delete this.editingAct.venue;
        },

        async saveAct() {
            if (!this.editingAct?.title?.trim()) {
                alert('Il titolo è obbligatorio');
                return;
            }
            try {
                const isUpdate = !!this.editingAct.id;
                const url = isUpdate
                    ? `${this.BASE_URL}/festival/planner/acts/${this.editingAct.id}`
                    : `${this.BASE_URL}/festival/planner/acts`;
                const payload = {
                    title: this.editingAct.title,
                    description: this.editingAct.description,
                    status: this.editingAct.status,
                    category: this.editingAct.category,
                    venueId: this.editingAct.venueId || null,
                    day: this.editingAct.day || null,
                    startTime: this.editingAct.startTime || null,
                    endTime: this.editingAct.endTime || null,
                    price: parseFloat(this.editingAct.price) || 0
                };
                const res = await fetch(url, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Errore salvataggio atto");
                this.editingAct = null;
                await this.fetchPlannerData();
            } catch (e) { alert(e.message); }
        },

        async deleteAct(id) {
            if (!await this.showConfirm("Eliminare questo atto?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/festival/planner/acts/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore eliminazione atto");
                this.editingAct = null;
                await this.fetchPlannerData();
            } catch (e) { alert(e.message); }
        },

        timeToSlotIndex(time) {
            if (!time) return null;
            const hour = parseInt(String(time).split(':')[0], 10);
            if (Number.isNaN(hour)) return null;
            const label = `${String(hour).padStart(2, '0')}:00`;
            return this.plannerTimeSlots.findIndex(s => s.value === label);
        },

        actGridRow(act) {
            const startIndex = this.timeToSlotIndex(act.startTime);
            if (startIndex === null || startIndex < 0) return null;
            const day = this.plannerDays.find(d => d.value === this.plannerSelectedDay);
            const slotsLen = this.plannerTimeSlots.length;
            let endIndex = null;

            if (act.endTime) {
                endIndex = this.timeToSlotIndex(act.endTime);
                const endHour = parseInt(String(act.endTime).split(':')[0], 10);
                if ((endIndex === null || endIndex < 0) && day && endHour === day.endHour) {
                    endIndex = slotsLen;
                }
                if (endIndex === null || endIndex < 0 || endIndex <= startIndex) {
                    endIndex = slotsLen;
                }
            } else {
                endIndex = startIndex + 1;
            }

            const gridStart = startIndex + 2;
            const gridEnd = endIndex + 2;
            return `${gridStart} / ${gridEnd}`;
        },

        actGridColumn(act) {
            if (!act.venueId) return null;
            const idx = this.plannerVenues.findIndex(v => v.id === act.venueId);
            if (idx < 0) return null;
            return `${idx + 2}`;
        },

        getActDurationSlots(act) {
            const startIndex = this.timeToSlotIndex(act.startTime);
            if (startIndex === null || startIndex < 0) return 1;
            const day = this.plannerDays.find(d => d.value === this.plannerSelectedDay);
            const slotsLen = this.plannerTimeSlots.length;
            const endIndex = this.timeToSlotIndex(act.endTime);
            if (endIndex === null || endIndex < 0 || endIndex <= startIndex) {
                if (day && act.endTime) {
                    const endHour = parseInt(String(act.endTime).split(':')[0], 10);
                    if (!Number.isNaN(endHour) && endHour === day.endHour) {
                        return Math.max(1, slotsLen - startIndex);
                    }
                }
                return Math.max(1, slotsLen - startIndex);
            }
            return Math.max(1, endIndex - startIndex);
        },

        onActDragStart(act, event) {
            if (!this.canWrite) return;
            const durationSlots = this.getActDurationSlots(act);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/json', JSON.stringify({
                id: act.id,
                durationSlots,
            }));
        },

        onGridDragOver(event) {
            if (!this.canWrite) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
        },

        async onGridDrop(event, slotIndex, venueId) {
            if (!this.canWrite) return;
            event.preventDefault();
            try {
                const raw = event.dataTransfer.getData('application/json');
                if (!raw) return;
                const data = JSON.parse(raw);
                const act = this.plannerActs.find(a => a.id === data.id);
                if (!act) return;
                const duration = Math.max(1, data.durationSlots || 1);
                const slotsLen = this.plannerTimeSlots.length;
                const newStartIndex = Math.max(0, Math.min(slotIndex, slotsLen - 1));
                const newEndIndex = Math.min(slotsLen, newStartIndex + duration);

                const startLabel = this.plannerTimeSlots[newStartIndex]?.value || null;
                let endLabel = null;
                if (newEndIndex >= slotsLen) {
                    const day = this.plannerDays.find(d => d.value === this.plannerSelectedDay);
                    if (day) {
                        endLabel = `${String(day.endHour).padStart(2, '0')}:00`;
                    }
                } else {
                    endLabel = this.plannerTimeSlots[newEndIndex]?.value || null;
                }

                const payload = {
                    title: act.title,
                    description: act.description,
                    status: act.status,
                    category: act.category,
                    venueId: venueId || null,
                    day: this.plannerSelectedDay,
                    startTime: startLabel,
                    endTime: endLabel,
                    price: parseFloat(act.price) || 0
                };

                const res = await fetch(`${this.BASE_URL}/festival/planner/acts/${act.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Errore salvataggio atto");
                await this.fetchPlannerData();
            } catch (e) {
                alert(e.message);
            }
        },

        async onUnscheduledDrop(event) {
            if (!this.canWrite) return;
            event.preventDefault();
            try {
                const raw = event.dataTransfer.getData('application/json');
                if (!raw) return;
                const data = JSON.parse(raw);
                const act = this.plannerActs.find(a => a.id === data.id);
                if (!act) return;

                const payload = {
                    title: act.title,
                    description: act.description,
                    status: act.status,
                    category: act.category,
                    venueId: null,
                    day: null,
                    startTime: null,
                    endTime: null,
                    price: parseFloat(act.price) || 0
                };

                const res = await fetch(`${this.BASE_URL}/festival/planner/acts/${act.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Errore salvataggio atto");
                await this.fetchPlannerData();
            } catch (e) {
                alert(e.message);
            }
        },

        actColor(act) {
            const map = {
                draft: '#e2e8f0',
                tentative: '#fefcbf',
                confirmed: '#c6f6d5',
                cancelled: '#fed7d7',
            };
            return map[act.status] || '#e2e8f0';
        },

        actBorderColor(act) {
            const map = {
                draft: '#a0aec0',
                tentative: '#d69e2e',
                confirmed: '#38a169',
                cancelled: '#e53e3e',
            };
            return map[act.status] || '#a0aec0';
        },

        categoryLabel(cat) {
            const labels = {
                talk: 'Talk',
                djset: 'DJ Set',
                walk: 'Walk',
                performance: 'Performance',
                workshop: 'Workshop',
                concert: 'Concerto',
                other: 'Altro',
            };
            return labels[cat] || cat;
        },

        async startFestivalApproval(t) {
            try {
                const res = await fetch(`${this.BASE_URL}/festival/${t.id}/email-template`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                const { subject: emailSubject, body: emailBody } = await res.json();
                this.festivalApproval = { ticket: t, emailSubject, emailBody };
            } catch (e) { alert(e.message); }
        },

        async confirmFestivalApproval() {
            const { ticket, emailSubject, emailBody } = this.festivalApproval;
            try {
                const res = await fetch(`${this.BASE_URL}/festival/${ticket.id}/confirm`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify({ emailSubject, emailBody })
                });
                if (!res.ok) throw new Error("Errore conferma biglietto");
                this.festivalApproval = null;
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async restoreFestivalTicket(t) {
            if (!await this.showConfirm("Ripristinare questo biglietto?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/festival/${t.id}/restore`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore ripristino");
                await this.fetchData();
            } catch (e) { alert(e.message); }
        },

        async deleteFestivalTicket(id) {
            if (await this.showConfirm("Eliminare questo biglietto?")) {
                try {
                    const res = await fetch(`${this.BASE_URL}/festival/${id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });
                    if (!res.ok) throw new Error("Errore eliminazione");
                    await this.fetchData();
                } catch (e) { alert(e.message); }
            }
        },

        // ── Calendar ──

        initCalendar() {
            const el = document.getElementById('fullcalendar');
            if (!el) return;
            if (this.calendarInstance) {
                this.calendarInstance.destroy();
                this.calendarInstance = null;
            }
            const self = this;
            this.calendarInstance = new FullCalendar.Calendar(el, {
                initialView: 'dayGridMonth',
                locale: 'it',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'dayGridMonth,timeGridWeek,listWeek'
                },
                editable: false,
                selectable: this.canWrite,
                events: function (info, successCallback, failureCallback) {
                    const start = info.startStr.split('T')[0];
                    const end = info.endStr.split('T')[0];
                    fetch(`${self.BASE_URL}/calendar/?start=${start}&end=${end}`, {
                        headers: { 'Authorization': `Bearer ${self.token}` }
                    })
                        .then(res => {
                            if (!res.ok) throw new Error('Errore caricamento eventi');
                            return res.json();
                        })
                        .then(events => {
                            successCallback(events.map(ev => ({
                                id: ev.uid,
                                title: ev.summary || '',
                                start: ev.dtstart,
                                end: ev.dtend,
                                allDay: ev.dtstart && ev.dtstart.length === 10,
                                extendedProps: {
                                    description: ev.description || '',
                                    location: ev.location || '',
                                    uid: ev.uid
                                }
                            })));
                        })
                        .catch(err => {
                            console.error(err);
                            alert('Errore caricamento calendario');
                            failureCallback(err);
                        });
                },
                select: function (info) {
                    self.editingCalendarEvent = {
                        summary: '',
                        dtstart: info.startStr.split('T')[0],
                        dtend: info.endStr.split('T')[0],
                        description: '',
                        location: '',
                        allDay: true,
                        uid: null
                    };
                },
                eventClick: function (info) {
                    const ev = info.event;
                    const isAllDay = ev.allDay;
                    let dtstart, dtend;
                    if (isAllDay) {
                        dtstart = ev.startStr;
                        dtend = ev.endStr || ev.startStr;
                    } else {
                        dtstart = ev.startStr.slice(0, 16);
                        dtend = ev.endStr ? ev.endStr.slice(0, 16) : dtstart;
                    }
                    self.editingCalendarEvent = {
                        uid: ev.id,
                        summary: ev.title,
                        dtstart,
                        dtend,
                        description: ev.extendedProps.description || '',
                        location: ev.extendedProps.location || '',
                        allDay: isAllDay
                    };
                }
            });
            this.calendarInstance.render();
        },

        openCreateCalendarEvent() {
            const today = new Date().toISOString().split('T')[0];
            this.editingCalendarEvent = {
                summary: '',
                dtstart: today,
                dtend: today,
                description: '',
                location: '',
                allDay: true,
                uid: null
            };
        },

        async saveCalendarEvent() {
            try {
                const ev = this.editingCalendarEvent;
                if (!ev.summary || !ev.dtstart) {
                    alert('Titolo e data inizio sono obbligatori');
                    return;
                }
                const payload = {
                    summary: ev.summary,
                    dtstart: ev.dtstart,
                    dtend: ev.dtend || ev.dtstart,
                    description: ev.description,
                    location: ev.location
                };
                const isUpdate = !!ev.uid;
                const url = isUpdate
                    ? `${this.BASE_URL}/calendar/${encodeURIComponent(ev.uid)}`
                    : `${this.BASE_URL}/calendar/`;
                const res = await fetch(url, {
                    method: isUpdate ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || 'Errore salvataggio evento');
                }
                this.editingCalendarEvent = null;
                if (this.calendarInstance) this.calendarInstance.refetchEvents();
            } catch (e) { alert(e.message); }
        },

        async deleteCalendarEvent(uid) {
            if (!await this.showConfirm('Eliminare questo evento?')) return;
            try {
                const res = await fetch(`${this.BASE_URL}/calendar/${encodeURIComponent(uid)}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || 'Errore eliminazione evento');
                }
                this.editingCalendarEvent = null;
                if (this.calendarInstance) this.calendarInstance.refetchEvents();
            } catch (e) { alert(e.message); }
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
            this.editingUser = {
                username: '',
                password: '',
                email: '',
                role: 'reader',
                allowedTabs: [],
                allowedWriteTabs: [],
                active: true
            };
        },

        openEditUser(user) {
            this.editingUser = {
                ...user,
                password: '',
                allowedTabs: user.allowedTabs || [],
                allowedWriteTabs: user.allowedWriteTabs || []
            };
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

        toggleWriteTab(tab) {
            if (!this.editingUser) return;
            const idx = this.editingUser.allowedWriteTabs.indexOf(tab);
            if (idx === -1) {
                this.editingUser.allowedWriteTabs.push(tab);
            } else {
                this.editingUser.allowedWriteTabs.splice(idx, 1);
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
        },

        // ── Telegram Bot Management ──

        async fetchTelegramData() {
            try {
                const [chatsRes, settingsRes] = await Promise.all([
                    fetch(`${this.BASE_URL}/telegram/chats`, { headers: { 'Authorization': `Bearer ${this.token}` } }),
                    fetch(`${this.BASE_URL}/telegram/settings`, { headers: { 'Authorization': `Bearer ${this.token}` } })
                ]);
                if (chatsRes.ok) this.telegramChats = await chatsRes.json();
                if (settingsRes.ok) this.telegramSettings = await settingsRes.json();
            } catch (e) { console.error(e); }
        },

        openAddChat() {
            this.editingChat = { chatId: '', label: '', active: true, notifyDigest: true, notifyResidency: true, notifyMembership: true, notifyFestival: true };
        },

        openEditChat(chat) {
            this.editingChat = { ...chat };
        },

        async saveChat() {
            if (!this.editingChat.chatId?.trim()) {
                alert('Chat ID obbligatorio');
                return;
            }
            try {
                const isUpdate = !!this.editingChat.id;
                const url = isUpdate
                    ? `${this.BASE_URL}/telegram/chats/${this.editingChat.id}`
                    : `${this.BASE_URL}/telegram/chats`;
                const res = await fetch(url, {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(this.editingChat)
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || 'Errore salvataggio chat');
                }
                this.editingChat = null;
                await this.fetchTelegramData();
            } catch (e) { alert(e.message); }
        },

        async deleteChat(id) {
            if (!await this.showConfirm("Eliminare questa chat?")) return;
            try {
                const res = await fetch(`${this.BASE_URL}/telegram/chats/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore eliminazione chat");
                await this.fetchTelegramData();
            } catch (e) { alert(e.message); }
        },

        async saveTelegramSettings() {
            try {
                const res = await fetch(`${this.BASE_URL}/telegram/settings`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                    body: JSON.stringify(this.telegramSettings)
                });
                if (!res.ok) throw new Error("Errore salvataggio impostazioni");
                alert('Impostazioni salvate');
            } catch (e) { alert(e.message); }
        },

        async previewDigest() {
            try {
                const res = await fetch(`${this.BASE_URL}/telegram/digest/preview`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore caricamento anteprima");
                const data = await res.json();
                this.digestPreview = data.text;
            } catch (e) { alert(e.message); }
        },

        async sendDigestNow() {
            if (!await this.showConfirm("Inviare il riepilogo ora?")) return;
            this.digestSending = true;
            try {
                const res = await fetch(`${this.BASE_URL}/telegram/digest/send`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                if (!res.ok) throw new Error("Errore invio riepilogo");
                alert('Riepilogo inviato!');
            } catch (e) { alert(e.message); }
            finally { this.digestSending = false; }
        }
    }));
});

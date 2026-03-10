document.addEventListener('alpine:init', () => {
    Alpine.data('app', () => ({
        BASE_URL: 'http://localhost:3000',
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
        editingGuest: null,
        newGuestToggle: false,
        newGuestName: '',
        filter: 'all',
        habitanteFilter: 'all',
        stats: { totalIn: 0, totalOut: 0, balance: 0 },
        loginData: { username: '', password: '' },

        async init() {
            if (this.token) await this.fetchData();
        },

        formatDate(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        },

        async setView(v) {
            this.view = v;
            this.selectedGuest = null;
            this.editingItem = null;
            this.editingBooking = null;
            this.editingGuest = null;
            await this.fetchData();
        },

        async fetchData() {
            if (!this.token) return;
            try {
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

                if (this.view === 'expenses') {
                    this.updateStats();
                    this.$nextTick(() => this.renderChart());
                }
            } catch (e) { console.error(e); }
        },

        get filteredItems() {
            if (this.view !== 'expenses') return this.items;

            return this.items.filter(i => {
                const isExit = String(i.isExit) === 'true';
                
                let matchType = true;
                if (this.filter === 'in') matchType = !isExit;
                if (this.filter === 'out') matchType = isExit;

                if (this.filter !== 'out') return matchType;

                let matchHabitante = true;
                if (this.habitanteFilter !== 'all') {
                    if (this.habitanteFilter === 'habitat') {
                        matchHabitante = i.payerType === 'habitat';
                    } else {
                        matchHabitante = i.payerType === 'habitante' && i.specificHabitante === this.habitanteFilter;
                    }
                }

                return matchType && matchHabitante;
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
            if (this.chart) this.chart.destroy();
            this.chart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels: sorted.map(i => this.formatDate(i.date)),
                    datasets: [{ label: 'Flow', data: sorted.map(i => String(i.isExit) === 'true' ? -i.amount : i.amount), borderColor: '#000', tension: 0.1, fill: false }]
                },
                options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { font: { size: 9 } } } } }
            });
        },

        async selectGuest(guest) {
            this.selectedGuest = guest;
            const res = await fetch(`${this.BASE_URL}/bookings/`, { headers: { 'Authorization': `Bearer ${this.token}` } });
            const allB = await res.json();
            this.guestHistory = allB.filter(b => (b.guest?._id || b.guest) === guest._id);
        },

        isGuestPresent(guestId) {
            const today = new Date().setHours(0,0,0,0);
            return this.allBookings.some(b => {
                const gId = b.guest?._id || b.guest;
                return gId === guestId && today >= new Date(b.checkIn).setHours(0,0,0,0) && today <= new Date(b.checkOut).setHours(0,0,0,0);
            });
        },

        getBookingStatus(b) {
            const today = new Date().setHours(0,0,0,0);
            const start = new Date(b.checkIn).setHours(0,0,0,0);
            const end = new Date(b.checkOut).setHours(0,0,0,0);
            if (today < start) return '🔜 Futuro';
            if (today > end) return '✅ Concluso';
            return '🏠 In corso';
        },

        openCreateGuest() {
            this.editingGuest = { name: '', email: '', phone: '', isConfirmed: false };
        },

        async saveGuest() {
            try {
                const isUpdate = !!this.editingGuest._id;
                const url = isUpdate ? `${this.BASE_URL}/guests/${this.editingGuest._id}` : `${this.BASE_URL}/guests/`;
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
            const isUpdate = !!this.editingItem._id;
            const payload = { 
                ...this.editingItem, 
                amount: Number(this.editingItem.amount),
                isExit: String(this.editingItem.isExit) === 'true', 
                category: String(this.editingItem.isExit) === 'true' ? 'uscita' : 'entrata' 
            };
            await fetch(isUpdate ? `${this.BASE_URL}/expenses/${this.editingItem._id}` : `${this.BASE_URL}/expenses/`, {
                method: isUpdate ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                body: JSON.stringify(payload)
            });
            this.editingItem = null;
            await this.fetchData();
        },

        async saveBooking() {
            let guestId = this.editingBooking.guest;
            if (this.newGuestToggle && this.newGuestName) {
                const resG = await fetch(`${this.BASE_URL}/guests/`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` }, 
                    body: JSON.stringify({ name: this.newGuestName, isConfirmed: false }) 
                });
                const newG = await resG.json();
                guestId = newG._id;
            }
            const isUpdate = !!this.editingBooking._id;
            await fetch(isUpdate ? `${this.BASE_URL}/bookings/${this.editingBooking._id}` : `${this.BASE_URL}/bookings/`, {
                method: isUpdate ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                body: JSON.stringify({ ...this.editingBooking, guest: guestId })
            });
            this.editingBooking = null;
            await this.fetchData();
        },

        async login() {
            const res = await fetch(`${this.BASE_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.loginData) });
            const d = await res.json();
            if (d.token) { this.token = d.token; localStorage.setItem('token', d.token); await this.fetchData(); }
        },

        logout() { this.token = ''; localStorage.removeItem('token'); },
        
        openCreate() { 
            this.editingItem = { 
                title: '', description: '', amount: 0, date: new Date().toISOString().split('T')[0], 
                isExit: true, receiptType: 'nessuno', payerType: 'habitat', paymentMethod: 'cash', 
                isRepeatable: false, repeatInterval: 'monthly' 
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
            
            const guestId = b.guest?._id || b.guest;
            
            this.editingBooking = { 
                ...b, 
                checkIn: b.checkIn.split('T')[0], 
                checkOut: b.checkOut.split('T')[0], 
                guest: guestId, 
                feedback: b.feedback || '' 
            };
        },
        
        async deleteItem(id) { if (confirm("Eliminare?")) { await fetch(`${this.BASE_URL}/${this.view}/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${this.token}` } }); await this.fetchData(); } }
    }));
});
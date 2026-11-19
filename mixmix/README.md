# Mixmix — la radio di Habitat

Pagina pubblica (habitattt.it/mixmix/): la radio sincronizzata per tutti (il loop dei set con "radio" + i set programmati,
calcolato nel browser da `radio.js`), l'archivio dei mix e delle playlist, la mappa delle curve di livello intorno a Cà de Monti
che reagisce alla musica (three.js, `terrain.json`). Layout "minimal", palette brace.

I dati arrivano dal formulario-backend (`BASE_URL` da `../config.js`): `/mixmix/state`, `/mixmix/stats`, `/mixmix/beat|play`,
audio in `/mixmix/media/`, copertine in `/mixmix/covers/`. I set si gestiscono dal formulario, scheda **Mixmix** (`admin/mixmix.js`).

Interfaccia in inglese. Font: birbi (Habitat License). three.js: MIT (vendor/).

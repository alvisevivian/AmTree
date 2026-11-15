# AmTree — Fasi 1 e 2

Fonte: cartella locale AmTree Patch 11. L'originale in Downloads è rimasto invariato.

## Modifiche

Logo principale portato a 180 × 60 px, con adattamento mobile; favicon collegata al logo SVG AmTree. Il pulsante Data & Method apre ora Team, con i cinque nomi richiesti e il logo NASA Space Apps Milano fornito, conservato con il suo sfondo blu scuro. Le note scientifiche originali restano nei file pubblici. Nessuna modifica agli algoritmi o ai dati scientifici.

## Verifiche eseguite

Build TypeScript e Vite riuscita. Quattro test dei dati di confronto superati. Avvio backend riuscito su macOS con Python 3.14, spiceypy 8.4.0, numpy 2.5.4 e Pillow 13.0.0. HTTP 200 per frontend compilato, simulazione statica e simulazione dinamica di un'ora a intervalli di 240 secondi. Una data non valida restituisce un errore JSON. Non è stata effettuata una verifica visiva interattiva nel browser; il comportamento grafico e mobile richiede ancora tale controllo. Il build segnala un bundle JavaScript grande, senza errori bloccanti.

## Esecuzione e hosting

Installare Node e le dipendenze con `npm ci`, poi `npm run build`. Creare un ambiente Python e installare `pip install -r Backend/requirements.txt`. Avviare `python Backend/mission_server.py`: serve dist e API sullo stesso indirizzo, porta 4194. Durante lo sviluppo avviare anche `npm run dev`: Vite inoltra /api/mission-window al backend sulla porta 4194.

Le wheel incluse sono per Windows Python 3.13 e non funzionano sul Mac o su Linux; usare requirements.txt su tali sistemi. Gli script di preparazione dati MainImport.py e Moon Southern Map.py non fanno parte del runtime web e possono richiedere ulteriori librerie GIS.

GitHub conserva i sorgenti; un hosting statico serve soltanto dist. Le richieste di simulazione, esportazione e GIF usano /api/mission-window e richiedono Python attivo. Per Netlify o altro frontend statico serve una regola proxy HTTPS che inoltri questo percorso, query string inclusa, a un backend Python separato. Non è stato configurato alcun deploy. Senza proxy, il frontend statico non può eseguire simulazioni personalizzate.

Il backend ora accetta `--host 0.0.0.0 --port PORTA` per un hosting che richieda l'ascolto su tutte le interfacce. Pubblicare tramite un reverse proxy HTTPS. Occorrono Backend/kernels, Backend/window-horizons.json, src/data, src/lib/sites.ts e public/science; non copiare soltanto dist sul server Python. Le GIF richiedono tempo e memoria: verificare limiti e timeout del provider prima della pubblicazione.

Le API usano URL relativi alla stessa origine; il proxy evita richieste cross-origin e non richiede CORS. Non sono stati aggiunti header CORS permissivi. Non sono presenti configurazioni di autenticazione, limiti di traffico o gestione di produzione: il server incluso usa http.server Python. Il test locale non certifica capacità o sicurezza sotto carico pubblico.

Fasi GitHub e deploy non eseguite. Nessun nuovo commento nel codice.

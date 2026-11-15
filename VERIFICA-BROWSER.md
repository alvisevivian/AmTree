# AmTree browser — verifica del 15 novembre 2026

Il browser esegue gli stessi file mission_server.py e map_timelapses.py con Pyodide 0.27.7, NumPy 2.0.2 e Pillow 10.2.0. Un adattatore implementa le chiamate SPICE tramite NASA CSPICE compilato in WebAssembly, distribuito da SpiceQL 1.9.0. Formule, kernel e dati scientifici originali non sono stati modificati. Un service worker intercetta localmente simulazioni, immagini ed esportazioni; il calcolo avviene in un worker dedicato. Tutte le librerie sono incluse nel sito.

## Test eseguiti

Chrome desktop, server HTTP di soli file statici, senza backend di calcolo:

- Statica 10 gennaio 2027 ore 12:00 UTC: 5.625 valori confrontati con Python nativo.
- Dinamica 10–13 gennaio 2027, 72 ore, passo 240 secondi: 151.470 valori confrontati.
- Dinamica 5 giugno 2030 ore 01:00–03:00 UTC, passo 600 secondi: 7.245 valori confrontati.
- Stesse strutture per tutte le 15 località. Massimo scarto numerico circa 1,84e-10; tolleranza 1e-8. Nessuna differenza oltre la tolleranza.
- CSV, PNG, HTML, GIF illuminazione e GIF DSN per Site01 e region-malapert-massif: dieci esportazioni HTTP 200, contenuti non vuoti e firme file corrette.
- Date non valide, intervallo nullo, periodo invertito e data fuori copertura rifiutati con HTTP 400.
- Nessuna richiesta a domini esterni durante il test.
- Percorso reale nell'interfaccia Plan a landing → Run simulation → Simulation complete riuscito.
- Download reale del CSV verificato nel browser, nome AmTree-Site01.csv, senza errori. Le due GIF della simulazione di 72 ore risultano caricate con dimensioni immagini valide nella schermata di dettaglio.

## Pubblicazione Netlify

Collegare al proprio Netlify il fork alvisevivian/AmTree, branch main. Base directory vuota, build npm run build, publish dist. Il file netlify.toml contiene queste impostazioni. Non servono server Python, variabili API o proxy esterni; rimuovere eventuali proxy /api/* impostati in precedenza. La build prepara i file runtime con Node, senza Python. Usare Node 24.

Per sviluppo npm ci e npm run dev. Per provare il compilato npm run build e npm run preview. Aprire il sito via HTTPS o localhost: file:// non funziona.

## Limiti

Il primo calcolo scarica circa 43 MiB di runtime e dati scientifici, oltre agli asset del sito. Tempo e memoria dipendono dal dispositivo. I test coprono i casi elencati: non garantiscono uguaglianza assoluta di tutti i floating-point o dei byte compressi delle immagini. NumPy e Pillow differiscono dalle versioni native; compressione e rendering del testo possono variare pur usando gli stessi dati e algoritmi.

Safari, Firefox, dispositivi mobili fisici e dominio Netlify di produzione non sono ancora stati verificati. Servono WebAssembly, module workers e service workers. Gli URL /api/mission-window sono gestiti dal browser, non da un server: aprire prima AmTree per usare i collegamenti di esportazione. Richieste curl a un hosting statico non eseguono simulazioni.

VERIFICA.md e le istruzioni Windows originali descrivono la precedente architettura server. Le indicazioni sull'obbligo di hosting Python sono superate da questa edizione browser; il backend originale resta come riferimento per i confronti.

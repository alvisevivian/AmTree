# AmTree browser — verifica del 15 novembre 2026

## Transizione continua e caricamento nella dashboard

Questo aggiornamento sostituisce l'ordine di avvio descritto nella sezione successiva. Logo, texture della Luna e rilievo hanno preload espliciti. Il filmato segnala quando il renderer dei pianeti è pronto; solo allora viene importata e preparata in parallelo la scena interattiva. Non si attende più la fine del filmato per iniziare a costruire la Luna. La transizione conserva l'ultima posa del filmato e rimuove l'introduzione solo dopo il completamento dell'animazione, la preparazione della scena e la decodifica del logo.

Entrando nel planner, il pannello della dashboard mostra una barra di avanzamento al posto dei controlli. In quel momento vengono caricati e inizializzati Python, SPICE e i dati. La barra segue le fasi effettive di inizializzazione e il completamento dei file; non stima il tempo residuo né la percentuale dei byte. Il globo resta interattivo. La dashboard appare solo dopo la disponibilità del motore; in caso di errore è disponibile Retry.

Test Chrome e WebKit 27.2: nessun file /runtime/ prima del clic su Plan a landing; logo decodificato e scena pronta prima del caricamento scientifico; barra visibile nel pannello dopo il clic; preparazione completata e Run simulation riuscito. Su Chrome è stato verificato anche il trascinamento della Luna durante il caricamento, confrontando i fotogrammi prima e dopo. Build e sette test unitari superati. Le istruzioni precedenti sul caricamento del motore solo al primo Run simulation sono superate da questa versione.

## Avvio progressivo

L'animazione Earth-to-Moon parte direttamente dall'HTML, prima di React, del planner e del servizio browser. Il piccolo bootstrap (2,73 kB, 1,32 kB gzip) attende il completamento dell'animazione prima di importare l'applicazione principale (circa 1,46 MB). L'ultimo orientamento del filmato viene passato alla Luna interattiva per mantenere la transizione. L'introduzione resta visibile fino alla disponibilità della scena interattiva e non viene riprodotta una seconda volta. Un fallback a 20 secondi consente l'avvio dell'applicazione se il messaggio finale del filmato non arriva.

Il servizio browser viene installato entrando nel planner; l'analisi attende che sia pronto, senza bloccare l'animazione o la pagina iniziale. Pyodide, SPICE, kernel e terreno scientifico vengono caricati soltanto alla prima richiesta di simulazione. Questo intervento accelera l'apertura percepita ma non elimina il download iniziale dei circa 43 MiB necessari al primo calcolo.

Verifica da profilo browser nuovo su Chrome e WebKit 27.2: durante l'inizio del filmato non vengono richiesti il bundle principale né file /runtime/; dopo la fine dell'introduzione e all'apertura del planner non risultano richieste /runtime/; il primo Run simulation carica il worker e completa correttamente l'analisi. Build riuscita e sette test unitari superati. Il confronto delle dimensioni riguarda il bootstrap JavaScript, non tutti gli asset dell'animazione o il tempo su ogni connessione.

## Aggiornamento compatibilità SPICE

Segnalazione: Safari macOS, analisi dinamica 10 gennaio 2029 12:00 UTC – 13 gennaio 2029 12:00 UTC, errore SPKINSUFFDATA con epoca inattesa nel 1941. Le copie online di de432s.bsp e worker.js sono risultate identiche a quelle locali. Lo stesso errore non è stato riprodotto nei test automatici precedenti alla modifica: la causa specifica nella sessione Safari dell'utente resta non dimostrata.

Il collegamento Python/JavaScript ora trasferisce epoche e posizioni in batch tramite JSON, evitando conversioni numeriche implicite fra i due runtime. Le tre chiamate CSPICE usano un adattatore esplicito con buffer Float64 letti dopo la chiamata, anziché il marshaller generico delle firme. Se SPICE segnala SPKINSUFFDATA, i sei kernel vengono ricaricati e la stessa richiesta viene riprovata una sola volta. Un errore persistente continua a bloccare il calcolo: nessun risultato viene inventato o sostituito con un'approssimazione. I percorsi del worker e dell'adattatore Python sono stati versionati per evitare riuso della vecchia versione in cache.

Nuovi confronti eseguiti con Chrome, Firefox 159 e WebKit 27.2: quattro scenari, incluso il periodo segnalato nel 2029, tutte le 15 località e complessivamente 315.810 valori numerici per browser. Scarto massimo osservato inferiore a 2e-10 rispetto a Python nativo. Tutte le dieci esportazioni CSV/PNG/HTML/GIF e i quattro casi di input non valido passano sui tre motori. Aggiunti tre test automatici del collegamento: precisione delle epoche, recupero con ricaricamento kernel e rifiuto dell'errore persistente. npm test: sette test superati.

Il Safari reale installato sul computer non è stato automatizzato perché l'automazione remota è disabilitata nelle sue impostazioni. WebKit è il motore di Safari, ma il suo test automatico non certifica la sessione reale dell'utente o ogni piattaforma. Il nuovo commit deve essere sincronizzato nel fork e pubblicato da Netlify prima della conferma su amtree.earth. I riferimenti sotto a browser non ancora verificati descrivono la prima versione: Chrome, Firefox e WebKit sono ora coperti dai nuovi test; dispositivi mobili fisici restano da verificare.

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

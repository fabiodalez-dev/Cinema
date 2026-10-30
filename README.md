# Cinema

Una Home per TV LG webOS con interfaccia ispirata a Google TV, icone native e libreria Jellyfin. Progettata per essere leggibile dal divano e navigabile con il telecomando, anche su TV con risorse limitate.

## Schermate

![Home locale di Cinema](docs/screenshots/cinema-home.png)

<p align="center">
  <img src="docs/screenshots/cinema-settings.png" width="49%" alt="Impostazioni di Cinema">
  <img src="docs/screenshots/cinema-appearance.png" width="49%" alt="Personalizzazione degli sfondi">
</p>

<p align="center"><img src="docs/screenshots/cinema-tv-tools.png" width="70%" alt="Impostazioni → TV: memoria, app in background, pubblicità e servizi LG"></p>

Schermate del preview a 1920×1080, con dati personali omessi. La Home locale resta disponibile anche senza Jellyfin.

## Cosa offre

- Film, serie, riprendi visione con i prossimi episodi e album musicali Jellyfin, con cache e una Home locale sempre utilizzabile. L'account si collega dalla TV con Quick Connect.
- Live TV subito dietro ai controlli, selezione delle fonti e passaggio alla visione a schermo intero.
- Scopri e richieste tramite Litefin e il servizio Seerr già configurato sul server.
- Impostazioni a schermo intero: categorie con icone, righe grandi, interruttori e focus leggibile.
- Preferenze Cinema per animazioni, sfondi Jellyfin, ombra dei titoli Live e gestione dell’interfaccia.
- App e dock personalizzabili, sfondi, profili, musica ambiente, meteo, salvaschermo, backup, diagnostica e assistente vocale opzionale.

## Barra delle app

In Impostazioni → App → **Barra delle app** si sceglie **Estesa** (predefinita: una fila a tutta larghezza di riquadri uguali con il nome sempre visibile, e gli ingressi HDMI come riquadri, attenuati con «Nessun segnale») oppure **Compatta** (il dock centrato con le sole icone). All'avvio Cinema mostra subito l'ultima barra costruita, anche quando webOS l'aveva chiusa per liberare memoria.

## Strumenti TV

La scheda Impostazioni → **TV** richiede una TV con root (Homebrew Channel) e Python, che webOS include. Mostra solo quello che la TV in uso ha davvero: un'impostazione, un servizio o un tasto che il televisore non conosce non compare. Tutto si salva con **Salva** e si annulla con **Ripristina tutto come LG**.

- **Aggiornamenti**: Cinema e Bloomee dalle release ufficiali su GitHub, installati solo se l'impronta SHA-256 corrisponde a quella pubblicata. Una volta al giorno Cinema avvisa quando esce una versione nuova; niente viene installato senza il pulsante.
- **Memoria**: tiene aperte Cinema e Bloomee quando si apre un'altra app, così Home non riparte da zero e la musica non si ferma.
- **App caricate in background**: toglie dal precaricamento di LG le app che non usi (su webOS 5 vale dal riavvio successivo).
- **Pubblicità e tracciamento**: ID pubblicitario, Live Plus, promozioni e avvisi restano spenti; se LG li riaccende, Cinema li rispegne.
- **Servizi LG in background**: analisi dei contenuti, invio di log e diagnostica, suggerimenti, fermati a ogni avvio.
- **Tasti del telecomando**: Netflix, Prime Video, i tasti colorati, Guida, Info e gli altri che la TV riconosce possono aprire Cinema, Bloomee, un ingresso o un'app, da qualsiasi app, già prima che Cinema sia partita.
- **Accordi sui dati**: gli accordi accettati con LG, ciascuno con il suo interruttore. Spegnendone uno si ritira anche il documento da cui dipende, così non torna acceso al riavvio; i termini d'uso non vengono toccati.

- **Accensione**: con **Apri Cinema all'accensione** Cinema è pronta circa un minuto prima dopo un'accensione da corrente; nell'attesa si vede Live TV come sempre. Per partire Cinema usa un ingresso HDMI libero.

In Impostazioni → Salvaschermo, **Spegni la TV durante il salvaschermo** manda la TV in standby dopo 1-8 ore di salvaschermo di Cinema senza tasti premuti: un film o un'app in uso non vengono mai interrotti.

Dopo l'avvio e il risveglio dallo standby, se LG rimette in primo piano l'ultimo ingresso usato sopra Cinema, Cinema torna davanti da sola.

### Sicurezza

Su una TV con Homebrew Channel ogni app installata può già eseguire comandi come root attraverso il servizio di Homebrew Channel: Cinema non aggiunge un accesso che non ci sia già. Dove invece una cartella scrivibile da tutti potrebbe far scrivere root in un posto sbagliato, Cinema lo evita: il servizio TV gira da una copia in `/var/lib/launch-home-cinema` accessibile solo a root, i suoi file temporanei stanno in `/run/cinema-tvtools` (0700, senza seguire link simbolici), e gli aggiornamenti vengono scaricati e controllati in una cartella temporanea di root, non nella `/media/developer/temp` condivisa.

**Home** apre Cinema quando la rimappatura è configurata. Il **tasto giallo** alterna Cinema e vista essenziale. **Salva** applica le preferenze; **Chiudi** scarta le modifiche non salvate. Le animazioni sono brevi, disattivabili e rispettano il movimento ridotto.

## Build

```sh
npm ci
npm test
npm run pack
```

Il pacchetto mantiene l’ID applicazione esistente per conservare aggiornamenti, configurazione e hook. Non installare aggiornamenti di un’altra distribuzione se vuoi mantenere questa interfaccia.

[CINEMA.md](CINEMA.md) descrive configurazione, integrazione Jellyfin/Litefin, avvio e tasto Home. [VALIDATION.md](VALIDATION.md) riporta le verifiche sulla TV e i loro limiti.

Le credenziali rimangono sul dispositivo o sul server, fuori da sorgenti, pacchetto e backup delle preferenze Cinema.

## Cosa ho imparato su questa TV

Note di lavoro raccolte provando Cinema su una LG 43UN70006LA con webOS 5.6.2 (firmware 04.64.00, root con Homebrew Channel 0.7.3). Valgono per questo modello; su altre TV webOS 5 sono un buon punto di partenza, non una garanzia.

### L'hardware e il browser

- Il browser delle app è Chromium 68. Le API più recenti (`Promise.allSettled`, `Array.prototype.flat`, `?.` a runtime, Cache API su `file://`) non ci sono o non funzionano: il codice va compilato per `chrome68` e controllato sul bundle. IndexedDB e `URL.createObjectURL` invece funzionano anche da `file://`.
- La memoria è poca: circa 1 GB condiviso con tutto il sistema, spesso 25-50 MB liberi e qualche centinaio di MB di swap. Nei primi minuti dopo l'accensione la TV va in swap e la stessa pagina che a regime è pronta in 0,5 s può impiegarne 6-7.
- Lo schermo lavora a 1920×1080 ma `devicePixelRatio` vale 2: le immagini vanno chieste al doppio della dimensione CSS. Gli sfondi 4K invece sono solo memoria sprecata (circa 39 MB decodificati ciascuno).
- Un `load average` intorno a 40 con la CPU all'85% inattiva è normale su questa TV: sono thread del kernel Realtek fermi in stato D, non un problema delle app.
- localStorage ha circa 5 MB condivisi fra tutte le chiavi dell'app: le immagini non ci vanno mai, nemmeno in base64.
- Python di sistema è solo il 2.7.15, senza python3: gli script root devono restare compatibili con il 2.7, e l'assistente vocale (che richiede Python 3.7-3.12) qui non può girare. La shell è busybox 1.29.

### Come si avvia la TV

- All'accensione il gestore di avvio di LG, bootd, segue le regole di `/etc/palm/action-condition.json` (sola lettura). Verso i 16 s lancia l'app dell'ultimo ingresso, che legge da `/var/lib/eim/lastinput` (campo `physicalLastSourceAppId`), quasi sempre Live TV.
- Gli hook di Homebrew Channel (`/var/lib/webosbrew/init.d`) partono solo verso i 55-70 s: prima di allora nessuno script root di Cinema è in esecuzione e il tasto Home apre la Home di LG.
- Fra i 75 e i 100 s bootd segnala `normal-boot-done`, chiude le app aperte durante l'avvio e riapre l'ultimo ingresso (`last_input_handler`). Un'app lanciata prima viene chiusa e ricaricata: Cinema va lanciata solo dopo la riga `Bootd's job is done` in `/var/log/bootd.log`, che viene riscritto a ogni avvio.
- WebAppMgr, che carica le app web, si registra verso i 40 s e lavora a priorità bassa fino alla fine dell'avvio di LG. Per questo un'app web non può essere davvero pronta prima.
- Se in `lastinput` si scrive un'app web, bootd non la apre davvero: apre `com.webos.app.inputcommon` sotto il suo nome (una scheda senza pagina, `windowGroup: true` in `getForegroundAppInfo` con `extraInfo`), con l'ingresso indicato in `physicalLastSourceId` dietro. Scrivendola da sola ho visto proprio questo: il segnale TV a schermo, il telecomando che non risponde, e un'installazione rimasta ferma su `app closing` perché quella scheda non si lascia chiudere.
- Funziona invece così, combinando le idee di [lgtv-webos-root-launcher](https://github.com/hbertsch/lgtv-webos-root-launcher) e [lg-luma](https://github.com/ecklf/lg-luma/pull/89). `lastinput` nomina Cinema su un HDMI senza nulla collegato e viene bloccato in sola lettura con un bind mount (le riscritture di LG falliscono, e LG a fine avvio non ha nessun Live TV da riaprire sopra Cinema). Il filtro tasti del compositore, che LG carica pochi secondi dopo l'accensione e che può chiamare direttamente il gestore delle app, copre la scheda vuota con Live TV appena compare e da `minimal-boot-done` lancia Cinema finché quella vera non è davanti. Risultato su questa TV: logo LG fino a circa 20 s, due secondi di nero, Live TV con il telecomando funzionante, Cinema pronta a circa 42 s invece di 111. È l'opzione «Apri Cinema all'accensione» in Impostazioni → TV.
- Lasciare Live TV come ingresso in `lastinput` non basta: a fine avvio LG riapre comunque Live TV dalla memoria, sopra Cinema. E lanciare Cinema prima di `minimal-boot-done` mette soltanto la sua scheda vuota davanti a Live TV.
- Più presto di così un'app web non può comparire: lg-luma arriva a circa 20 s perché sostituisce l'eseguibile nativo della Home di LG e registra un servizio root in `/var/luna-service2` (che il bus legge già verso i 17 s), cose che a una Home in HTML non bastano.
- Le mattine sono avvii completi perché la presa ha un timer che toglie la corrente di notte. Con la corrente presente e Quick Start+ l'accensione è un risveglio e Cinema è davanti in 10-16 s. Al risveglio LG riapre l'ultimo ingresso che ricorda in memoria, anche con `lastinput` bloccato: lo rimanda indietro la guardia di Cinema.
- Il risveglio via Wake-on-LAN (la TV è in Wi-Fi) funziona dallo standby di Quick Start+, ma non dopo un taglio di corrente o uno standby lungo.
- L'orologio di sistema nei primi minuti dopo un taglio di corrente può non essere affidabile: lo spegnimento programmato aspetta dieci minuti di accensione e un orologio confermato.

### Homebrew Channel e la modalità di emergenza

- Se la TV si spegne o si riavvia mentre Homebrew Channel esegue i suoi hook, il riavvio successivo è in modalità di emergenza (failsafe): nessun hook gira. Il flag `/var/luna/preferences/webosbrew_failsafe` esiste per circa i primi 100 s: mai riavviare finché c'è.
- Il servizio root di Homebrew Channel esegue un comando alla volta: lanciarne molti insieme all'avvio ha bloccato un figlio in attesa per sempre, e con lui tutte le app che usano root. Cinema mette i comandi in coda, lascia passare prima quelli interattivi, fa chiudere dalla shell quelli scaduti e installa un guardiano che sblocca il servizio.
- L'output di un comando oltre circa 200 KB fa fallire la chiamata, e l'argomento di `sh -c` non può superare 128 KB: le liste lunghe vanno chieste in JSON compatto e i file lunghi scritti a pezzi.
- Uno script copiato da root con permessi 0600 non è eseguibile: va lanciato con `sh script`, non direttamente.

### Comandi e servizi di webOS

- `luna-send` su questa TV non stampa nulla senza `-i` e con lo standard input aperto: serve `luna-send -i -n 1 -w <ms> … </dev/null`.
- Il servizio di accensione ha `powerOff` (standby vero) e `turnOffScreen`, ma non `turnOff`.
- Riavviare `preload-manager` o `memchute` chiude tutte le app aperte.
- Dopo l'avvio `preloadmanager` lancia in background Live TV, YouTube, la voce e gli ingressi HDMI: compaiono fra le app attive ma non diventano mai visibili.
- `appinstalld` accetta un IPK da una cartella root 0700 in `/var/lib`, e chiude l'app che aggiorna prima di installarla: se l'app non si lascia chiudere l'installazione resta in attesa.
- WebAppMgr gira con `--disallow-code-cache-from-file-uris-with-query-string`: uno script caricato come `main.js?v=…` viene ricompilato da zero a ogni avvio. Cinema usa nomi di file che cambiano con il contenuto (`main.<versione>.<hash>.js`).
- I preload dei font da `file://` non vengono riutilizzati: il font viene scaricato due volte.
- La cattura dello schermo `luna://com.webos.service.capture/executeOneShot` con `method: SCREEN` restituisce l'immagine vera, video compreso; le schermate di DevTools invece non vedono il piano video. DevTools (porta 9998) elenca solo le app che hanno una pagina caricata.

### Telecomando e Live

- Il telecomando LG manda CH+ e CH− alle app web come PagSu e PagGiù (codici 33 e 34); Info è 457 e Guida 458. Il tasto Home (773) non arriva alle app: LG Input Hook lo rimappa su Cinema.
- La TV si guarda dentro Cinema con l'incorporamento `tv://` di Homebrew Channel. Per cambiare canale senza far comparire l'app TV di LG si imposta il canale come ultimo visto (`utp.channel/setLastChannelId`) e si riapre `tv://`.
- Le API del canale corrente rispondono solo con l'app TV di LG in primo piano; i dati della guida a volte hanno orari già scaduti.

### Dove guardare quando qualcosa va storto

- `/var/log/messages`: ogni lancio di app con chi l'ha chiesto (`NL_APP_LAUNCH_BEGIN`, campo `caller_id`), ogni scheda che compare o sparisce (`NL_VSC`) e ogni cambio di alimentazione con il motivo (`NL_POWER_STATE`, per esempio `remoteKey`).
- `/var/log/bootd.log`: la sequenza di avvio di LG, riscritta a ogni accensione.
- `/tmp/launch-home-boot.log`: cosa ha fatto Cinema all'avvio e al risveglio.
- `/run/cinema-tvtools/tvtools.log`: il servizio TV di Cinema; `/var/lib/launch-home-cinema/failsafe.log` per i riavvii dalla modalità di emergenza.

## Origine e licenze

Basato su [gprot42/webos-launch-home](https://github.com/gprot42/webos-launch-home). La licenza originale è conservata in [LICENSE](LICENSE); altre attribuzioni e licenze degli asset sono indicate nei sorgenti e in CINEMA.md. Gli Strumenti TV adattano tecniche di [Glasshouse](https://github.com/rorygallagher2024/glasshouse) (precaricamento via configd, filtro dei tasti nel compositore, accordi sui dati, servizi; MIT) e di [TV Tools](https://github.com/theo78825/tv-tools-public) (impostazioni LG tenute spente, spegnimento dopo il salvaschermo; MIT); la barra estesa si ispira a [Minimal Home](https://github.com/SchulzCode/WebOS-Minimal-Launcher).

## Client Jellyfin e Scopri

In Impostazioni → Cinema si può scegliere il client preferito oppure Automatico. Cinema riconosce Litefin, Moonfin, Jellyfin, Breezyfin e OcenFin. L'elenco dello store indica webOS 5+ per Litefin, Moonfin e Jellyfin, 7+ per Breezyfin e 10+ per OcenFin: la disponibilità dipende dal televisore. Nessun client aggiuntivo viene installato automaticamente.

I collegamenti diretti ai dettagli e alla ripresa usano l'adattatore Litefin opzionale; gli altri client si aprono nella propria interfaccia. Scopri resta sempre visibile. Con Litefin e il collegamento Seerr verificato apre direttamente il catalogo; con Moonfin spiega come usare la sua integrazione Seerr; con gli altri client offre l'apertura della libreria e la scelta di un client adatto. Senza app, account o server disponibili mostra un percorso di configurazione, lasciando accessibili Home, app e TV.

In Live i controlli spariscono dopo 10 secondi senza interazioni. Schermo intero li nasconde subito; OK o una freccia li riaprono. Lo sfondo della Home resta visibile mentre l'immagine sostitutiva si carica.

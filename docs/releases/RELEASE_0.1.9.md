# Cinema 0.1.9

Il dock è pronto appena Cinema si apre, anche quando webOS l'aveva chiusa per liberare memoria, e le icone di tutte le app tornano visibili.

## Cosa cambia

- **Elenco completo delle app.** Cinema legge come root l'elenco delle app installate. Homebrew Channel conserva al massimo circa 200 KB di risposta, e su una TV con 117 app l'elenco formattato superava quel limite: la richiesta falliva sempre, il dock e Tutte le app usavano elenchi parziali e alcune icone native mancavano. Ora l'elenco arriva come JSON compatto (119 KB).
- **Dock subito visibile.** Su una TV con 1 GB di RAM webOS chiude spesso Cinema quando si apre un'altra app, e premendo Home ripartiva da zero con il dock vuoto per circa un secondo. Cinema ora ricorda l'ultimo dock costruito con l'elenco completo e lo mostra all'avvio prima di qualsiasi chiamata al sistema; poi lo sostituisce con quello aggiornato lasciando il telecomando sulla stessa app.
- **Comandi root uno alla volta.** All'avvio Cinema mandava a Homebrew Channel diversi comandi in parallelo; in un caso il servizio è rimasto bloccato e con lui tutte le app che lo usano. Ora i comandi passano in coda, ciascuno con il suo limite di tempo. Nel repository c'è anche `scripts/hbchannel-watchdog.sh`, da copiare a mano in `/var/lib/webosbrew/init.d/`: ogni 30 secondi sblocca Homebrew Channel se un suo processo resta appeso.

## Installazione

Scarica `org.webosbrew.lounge.launcher_0.1.9_all.ipk` e installalo con webOS Dev Manager o con `ares-install`, come le versioni precedenti.

## Verifiche

74 test superati. Su una LG 43UN70006LA con webOS 5: dopo una chiusura forzata il dock ha già le sue 8 app prima che la pagina diventi visibile, e Tutte le app mostra l'icona di tutte le 20 app installate.

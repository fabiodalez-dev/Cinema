# Cinema 0.2.1

La TV esce da sola dalla modalità di emergenza di Homebrew Channel.

## Cosa cambia

- **Niente più TV «tornata come prima» dopo un distacco di corrente.** Se la corrente si stacca mentre la TV si avvia, al riavvio successivo Homebrew Channel entra in modalità di emergenza (failsafe) e non esegue nessuno dei suoi programmi di avvio: niente Cinema all'accensione, niente tasto Home rimappato, niente strumenti TV, niente blocco degli aggiornamenti LG. Ora Cinema registra un'attività di avvio sua, lo stesso meccanismo che usa Homebrew Channel, che parte anche in modalità di emergenza: se l'avvio è stato saltato, riavvia la TV una volta, come propone il messaggio «Failsafe mode» di Homebrew Channel, e tutto torna attivo. Se anche quel riavvio finisse in modalità di emergenza, non ne fa un secondo, così un programma di avvio difettoso non può mai mandare la TV in un ciclo di riavvii.
- Aprendo Cinema dopo un avvio così, gli strumenti TV ripartono subito e un avviso lo dice.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.2.1_all.ipk` e webOS Dev Manager o `ares-install`. Chi ha gli strumenti TV attivi riceve l'attività di avvio alla prima apertura di Cinema dopo l'aggiornamento, senza fare altro.

## Verifiche

91 test JavaScript e 10 Python. Provata su una LG 43UN70006LA con webOS 5.6.2: con il flag di emergenza impostato come dopo un distacco di corrente, la TV si è avviata in modalità di emergenza, dopo circa tre minuti si è riavviata da sola ed è ripartita normalmente con Cinema in primo piano e tutti gli strumenti TV applicati.

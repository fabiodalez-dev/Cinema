# Cinema 0.3.2

Il primo avvio dopo l'accensione è più pulito: Cinema compare una volta sola e resta davanti.

## Cosa cambia

- **Niente più rimbalzo tra Live TV e Cinema all'accensione.** Circa cento secondi dopo l'accensione il sistema di LG chiude quello che si è aperto durante l'avvio e riapre l'ultimo ingresso. Cinema partiva prima di quel momento, veniva chiusa e ricaricata: si vedeva Cinema, poi di nuovo la TV per una decina di secondi, poi ancora Cinema. Ora Cinema aspetta che LG abbia finito e parte una sola volta.
- **OK non apre app per sbaglio mentre Cinema si prepara.** Nei primi secondi dopo l'avvio il tasto OK e i clic del puntatore vengono trattenuti, con il messaggio «Cinema si sta preparando, un attimo…». Le frecce funzionano subito.
- **Avviso quando un'app si apre.** Scegliendo un'app compare subito «Apertura di …»: alcune app, appena accesa la TV, impiegano diversi secondi a comparire.
- **Avvio a freddo più rapido.** Il codice di Cinema ora resta nella cache della TV fra un avvio e l'altro: a TV avviata la pagina è pronta in circa 0,8 secondi invece di 1,2.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.2_all.ipk` e webOS Dev Manager o `ares-install`.

## Verifiche

130 test JavaScript e 34 Python. Provata su una LG 43UN70006LA con webOS 5.6.2 con due riavvii completi: prima della correzione Cinema compariva a 87 secondi, spariva a 99 e tornava a 111; con la 0.3.2 compare a 111 secondi e resta davanti. OK premuto appena Cinema è comparsa mostra il messaggio e non apre nulla.

## Limiti noti

I primi cento secondi dopo l'accensione restano di LG: fino ad allora si vede la TV e il tasto Home apre la Home di LG, perché Homebrew Channel avvia Cinema solo a quel punto.

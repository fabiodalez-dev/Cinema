# Cinema 0.3.7

La striscia LED dietro la TV segue i colori del film e, a TV spenta, torna a fare da luce della stanza.

## Cosa cambia

- **Luci LED dietro la TV** in Impostazioni → TV. Una striscia Bluetooth della famiglia ELK-BLEDOM (quelle che si comandano con l'app Lotus Lantern) prende il colore dominante dello schermo, circa dieci volte al secondo. Le bande nere non contano, una scena buia dà una luce bassa, e un oggetto colorato su uno sfondo grigio vince sulla media spenta.
- **La luce d'ambiente.** Quando spegni la TV con il telecomando, o si spegne solo lo schermo, la striscia passa al colore scelto: bianco caldo, bianco, arancione, rosso, rosa, viola, blu, azzurro, verde, spenta, oppure l'ultimo colore del film. Ha una luminosità sua, separata da quella del film. È pensata per una striscia alimentata per conto suo, che resta accesa come luce della stanza.
- **Cerca, Prova e Salva.** «Cerca» trova le strisce nelle vicinanze in una decina di secondi, con nome, indirizzo e segnale. «Prova» mostra subito la luce d'ambiente scelta, anche prima di salvare.

## Come funziona

Un processo del servizio TV, `ambilight.py`, cattura lo schermo a 240×136 (video compreso), sceglie il colore e lo scrive nella striscia attraverso il servizio Bluetooth di LG. Il servizio di LG non sa chiudere davvero una connessione: per questo il processo tiene la striscia finché la TV è accesa e rilegge le impostazioni senza ripartire. Quando la lascia, riavvia il Bluetooth della TV, e il telecomando si ricollega da solo. Allo spegnimento LG annuncia «Request Power Off» un paio di secondi prima di spegnere il Bluetooth, e in quel momento la striscia riceve la luce d'ambiente. In standby il Bluetooth della TV è spento: l'app del telefono può prendere la striscia, e al risveglio la TV si ricollega. Dettagli nel README, sezione «Cosa ho imparato su questa TV».

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.7_all.ipk` e webOS Dev Manager o `ares-install`. Poi Impostazioni → TV → Luci LED: Cerca, scegli la striscia, accendi «I LED seguono i colori dello schermo», Salva. Prima di cercare chiudi l'app Lotus Lantern sul telefono: la striscia accetta un solo collegamento alla volta.

## Verifiche

143 test JavaScript e 67 Python. Provata su una LG 43UN70006LA con webOS 5.6.2 e una striscia ELK-BLEDOB:

- **Ricerca** dalla pagina delle impostazioni sulla TV: la striscia trovata in 12 secondi.
- **Colori**: con Live TV accesa la striscia riceve un colore nuovo a ogni cambio di scena, e ogni scrittura viene confermata dalla striscia. Una pubblicità blu dà blu, una stanza dai toni caldi dà arancione.
- **Spegnimento con il tasto del telecomando**: la luce d'ambiente viene scritta nello stesso secondo dell'annuncio di LG, la TV va in standby normale, e al risveglio si ricollega in 3 secondi e torna a seguire lo schermo.
- **Solo schermo spento**: luce d'ambiente, e alla riaccensione di nuovo il film.
- **Aggiornamento**: il processo vecchio lascia la striscia con la luce d'ambiente e quello nuovo la riprende entro 20 secondi.
- **Consumo**: cattura e calcolo insieme usano circa il 15% della CPU della TV.

## Limiti noti

Non ho guardato la striscia con i miei occhi: le scritture sono confermate dalla striscia, ma la resa dei colori va giudicata in salotto. Non ho provato Netflix e Prime Video: se un video protetto non si lascia catturare, la striscia resta sull'ultimo colore. Quando la TV si spegne per un'interruzione di corrente non c'è nessun annuncio, quindi la striscia resta sull'ultimo colore del film. Con l'opzione spenta, «Prova» riavvia il Bluetooth della TV per lasciare la striscia al telefono: per qualche secondo il telecomando punta e clicca non risponde.

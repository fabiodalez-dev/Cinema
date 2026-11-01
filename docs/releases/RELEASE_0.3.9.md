# Cinema 0.3.9

Le luci LED dietro la TV, rifatte dopo una sera di prove in salotto: la luce della stanza arriva davvero, i colori sono morbidi e giusti, e il Bluetooth della TV non si blocca più.

## Cosa cambia

- **La luce della stanza a TV spenta arriva.** Quando il servizio Bluetooth di LG si bloccava, il controller della striscia provava a riavviarlo con `restart`, che sta in `/sbin` e non era nel suo PATH: il processo si chiudeva e ripartiva ogni 20 secondi, e allo spegnimento non c'era nessuno a scrivere il colore scelto. Ora il comando è chiamato con il percorso completo, il Bluetooth si riavvia al massimo una volta ogni due minuti e un errore finisce nel registro invece di chiudere il processo.
- **Il Bluetooth di LG non si blocca più.** Il servizio `webos-bluetooth` perdeva un file aperto per ogni `luna-send`: con i colori della striscia arrivava al limite di 1024 in una decina di minuti e smetteva di rispondere, e per una decina di secondi la striscia restava ferma. Ora tutte le chiamate passano da un solo client che resta collegato, un piccolo processo Node.js con la libreria del bus di webOS. Misurato sulla TV: prima 96 file in più al minuto, dopo nessuno in tre minuti.
- **Transizioni morbide.** Mentre gira un video LG impiega circa 0,42 secondi per catturare lo schermo. La cattura ora gira in un thread suo, e la striscia sfuma verso l'ultimo colore 20 volte al secondo invece di saltare da un colore all'altro.
- **Colori giusti, mai estremi.** Il colore dominante è mescolato con quello della scena, così un volto chiaro su una parete beige dà una luce calda e non un rosso pieno. Le proporzioni fra i canali passano per una curva, perché un 50 su 255 dello schermo è poca luce ma la striscia lo rende come un quinto del suo verde: senza correzione ogni arancione diventava un giallo pallido e tutto sembrava freddo. Il bianco della striscia, che tira all'azzurro, è riportato verso il caldo.
- **Il registro della striscia sopravvive al riavvio della TV.** Sta in `/var/lib/launch-home-cinema/ambilight.log`, poche righe al giorno.
- **Prova lo dice:** il testo sotto il pulsante ricorda che Prova non salva, e che per tenere la luce a TV spenta serve Salva.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.9_all.ipk` e webOS Dev Manager o `ares-install`. Il servizio TV prende da solo la versione nuova del controller LED entro 20 secondi.

## Verifiche

143 test JavaScript e 78 Python. Sulla LG 43UN70006LA con una striscia ELK-BLEDOB: allo spegnimento con il telecomando il registro scrive la luce rossa scelta nello stesso secondo dell'annuncio di LG, e al risveglio la striscia si ricollega; le scene calde di un film arrivano alla striscia come arancione (per esempio 110, 44, 16 per un marrone); il conto dei file aperti di `webos-bluetooth` resta fermo a 140 per tre minuti con la striscia che segue lo schermo.

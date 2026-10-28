# Cinema 0.2.3

In Live si cambia canale come su una TV normale, senza uscire da Cinema.

## Cosa cambia

- **CH+ e CH− cambiano canale.** Il telecomando LG manda questi tasti alle web app come PagSu e PagGiù, che Cinema finora ignorava: in Live si potevano cambiare solo le fonti. Ora il canale cambia dentro l'anteprima e l'app TV di LG non passa in primo piano. Più pressioni rapide portano direttamente al canale finale.
- **I tasti numerici sintonizzano il canale.** Si digita il numero come sulla TV: il canale si apre appena il numero non può più continuare, premendo OK oppure dopo una breve pausa. Un numero che non esiste viene segnalato.
- **Banner del canale.** A ogni cambio compaiono in alto a sinistra numero, nome e programma in onda, anche con i comandi nascosti. Il titolo di Live mostra il canale corrente.
- **Canali** sceglie il canale dalla lista e lo apre nell'anteprima. Da una fonte HDMI i tasti dei canali riportano alla TV.
- **Lista dei canali corretta.** Ogni canale della lista aveva il numero e il nome del canale successivo, per cui scegliendo un canale se ne apriva un altro, e il primo canale mancava. La lista salvata viene letta di nuovo.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.2.3_all.ipk` e webOS Dev Manager o `ares-install`.

## Verifiche

99 test JavaScript e 14 Python. Provata su una LG 43UN70006LA con webOS 5.6.2 premendo i tasti dal dispositivo del telecomando: CH+ da Canale5 a Italia1, il 7 su LA7 e il 20 su 20Mediaset, con Cinema sempre in primo piano e il banner con il programma; il 24, che non esiste, viene segnalato.

## Limiti noti

Un canale senza segnale resta nero e il messaggio "In attesa del segnale" compare solo con i comandi visibili. Sulla TV di prova LA7 non riceve segnale nemmeno nell'app TV di LG.

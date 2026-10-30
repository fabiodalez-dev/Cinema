# Cinema 0.3.3

Una correzione grafica e le note su come funziona davvero questa TV.

## Cosa cambia

- **Riquadri degli ingressi leggibili.** Nella barra estesa la scritta «Nessun segnale» sotto un ingresso HDMI spento andava a capo e si sovrapponeva al nome. Ora sta su una riga.
- **README: cosa ho imparato su questa TV.** Una sezione nuova raccoglie quello che ho scoperto lavorando su Cinema: come si avvia la TV e perché un'app web non può comparire prima della fine dell'avvio di LG, la modalità di emergenza di Homebrew Channel, i limiti del browser e della memoria, i comandi di webOS che si comportano in modo inatteso, i codici del telecomando e dove guardare quando qualcosa va storto.

## Una prova che non è entrata

Ho provato a far partire Cinema già a 20 secondi dall'accensione, facendola lanciare da LG come se fosse l'ultimo ingresso. LG crea la scheda di Cinema ma non carica la pagina finché il suo avvio non è finito: sullo schermo resta la TV, il telecomando non risponde e la scheda vuota blocca perfino gli aggiornamenti. Per questo la 0.3.3 non la include; i dettagli sono nel README.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.3_all.ipk` e webOS Dev Manager o `ares-install`.

## Verifiche

130 test JavaScript e 34 Python. Il riquadro corretto è stato controllato con una cattura reale dello schermo della TV.

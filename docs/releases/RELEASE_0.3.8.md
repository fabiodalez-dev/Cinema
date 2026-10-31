# Cinema 0.3.8

Correzione di sicurezza per le luci LED della 0.3.7.

## Cosa cambia

- **Il fotogramma catturato non passa più da `/tmp`.** Nella 0.3.7 il servizio di cattura di LG, che gira come root, scriveva l'immagine dello schermo in un file dal nome fisso dentro `/tmp`, una cartella in cui può scrivere qualsiasi app. Un'app poteva mettere al suo posto un collegamento a un altro file e farlo sovrascrivere. Ora il fotogramma sta in `/run/cinema-tvtools`, che solo root può aprire.

Per il resto è identica alla 0.3.7: le luci LED seguono i colori dello schermo e a TV spenta passano alla luce d'ambiente scelta. Le note complete sono nella [release 0.3.7](https://github.com/fabiodalez-dev/Cinema/releases/tag/v0.3.7).

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.8_all.ipk` e webOS Dev Manager o `ares-install`. Il servizio TV prende da solo la versione nuova del controller LED entro 20 secondi.

## Verifiche

143 test JavaScript e 67 Python. Sulla LG 43UN70006LA il servizio di cattura scrive nella cartella privata, e la striscia continua a seguire lo schermo.

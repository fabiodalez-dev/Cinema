# Cinema 0.3.4

All'accensione la TV può partire direttamente su Cinema invece che su Live TV.

## Cosa cambia

- **Impostazioni → TV → Accensione → Apri Cinema all'accensione.** LG all'accensione apre l'ultimo ingresso usato, quasi sempre Live TV, e alla fine del suo avvio lo riapre sopra qualsiasi cosa. Con questa opzione Cinema prende il posto dell'ultimo ingresso su un HDMI libero, così nel primo minuto lo schermo resta nero invece di mostrare la TV, poi compare Cinema e LG non la copre più. Sulla TV di prova Cinema è pronta a circa 63 secondi dall'accensione invece di 111.
- Canali, HDMI e Live TV si aprono come sempre. Spegnendo l'opzione, con «Ripristina tutto come LG» o disinstallando Cinema torna l'ultimo ingresso originale di LG.
- **README.** La sezione «Cosa ho imparato su questa TV» spiega il meccanismo, perché un'app web non può comparire prima e i progetti da cui ho preso l'idea.

## Come funziona

LG legge l'app da aprire da `/var/lib/eim/lastinput`. Per un'app web apre solo una scheda vuota, quindi Cinema la riconosce e lancia sé stessa appena Homebrew Channel parte; il file viene bloccato in sola lettura perché LG non lo riscriva. È la stessa tecnica di lgtv-webos-root-launcher e del PR #89 di lg-luma.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.4_all.ipk` e webOS Dev Manager o `ares-install`.

## Verifiche

131 test JavaScript e 42 Python. Provata su una LG 43UN70006LA con webOS 5.6.2: riavvii completi con Cinema pronta a circa 63 secondi e mai coperta da Live TV, HDMI 1 e Live TV aperti normalmente con il file bloccato, risveglio dallo standby con Cinema di nuovo davanti.

## Limiti noti

Nel primo minuto dopo l'accensione da corrente lo schermo è nero e il telecomando non fa nulla, perché fino ad allora Homebrew Channel non è partito. Al risveglio dallo standby LG può ancora riaprire per un attimo l'ultimo ingresso usato prima che Cinema torni davanti.

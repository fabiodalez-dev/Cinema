# Cinema 0.3.1

Due correzioni di sicurezza sopra la 0.3.0, senza cambiamenti visibili.

## Cosa cambia

- **Credenziali protette dal primo byte.** Quando Cinema scrive come root il collegamento a Jellyfin o un backup delle impostazioni, il file nasce già leggibile solo da root. Prima, per un attimo durante la scrittura, il file temporaneo era leggibile da tutti. Se i permessi non si possono applicare, il file viene eliminato.
- **Ripristino più prudente.** Lo script di ripristino del dispositivo ferma un processo solo se è davvero quello di Cinema (controllo del tasto Home, avvio, voce, servizio TV, guardiano di Homebrew Channel). Prima si fidava del numero scritto in un file temporaneo che qualunque app poteva modificare.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.1_all.ipk` e webOS Dev Manager o `ares-install`.

## Verifiche

130 test JavaScript e 34 Python. Il controllo dei processi dello script di ripristino è stato provato con processi corrispondenti, non corrispondenti e numeri non validi.

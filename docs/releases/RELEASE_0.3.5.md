# Cinema 0.3.5

Cinema arriva un minuto prima all'accensione, e nell'attesa si vede la TV.

## Cosa cambia

- **Niente più schermo nero.** Nella 0.3.4 l'opzione «Apri Cinema all'accensione» lasciava lo schermo nero per circa un minuto. Ora, mentre Cinema si prepara, si vede Live TV con il telecomando che funziona, come sempre.
- **Cinema pronta a circa 42 secondi.** Era a 63 nella 0.3.4 e a 111 senza l'opzione. Cinema ora viene avviata già dal filtro dei tasti che LG carica pochi secondi dopo l'accensione, e non più solo quando parte Homebrew Channel.
- LG non rimette Live TV sopra Cinema alla fine del suo avvio.

## Come funziona

Il file con l'ultimo ingresso di LG nomina Cinema su un HDMI libero ed è bloccato in sola lettura. LG per un'app web crea solo una finestra vuota: il filtro dei tasti di Cinema, caricato da LG nel compositore all'accensione, la copre con Live TV e lancia Cinema appena LG accetta le app, finché Cinema non è davanti. Dettagli nel README, sezione «Cosa ho imparato su questa TV».

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.5_all.ipk` e webOS Dev Manager o `ares-install`. Dopo l'aggiornamento, apri Impostazioni → TV e premi Salva per aggiornare il filtro, oppure riavvia la TV.

## Verifiche

131 test JavaScript e 45 Python. Provata su una LG 43UN70006LA con webOS 5.6.2 con riavvii completi: logo LG fino a 20 secondi, due secondi di nero, Live TV fino a 42 secondi, poi Cinema, che resta davanti fino alla fine dell'avvio di LG e oltre.

## Limiti noti

Restano due secondi di nero verso i 20 secondi, quando LG apre la finestra vuota prima che il filtro la copra. Se tutti gli HDMI sono occupati, Cinema parte su Live TV e a fine avvio LG può riaprirla per qualche secondo.

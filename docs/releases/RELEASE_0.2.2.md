# Cinema 0.2.2

Spegnimento programmato: ogni giorno, all'orario scelto, la TV si spegne da sola.

## Cosa cambia

- **Impostazioni → TV → Spegnimento programmato.** Si sceglie un orario a passi di mezz'ora, oppure Mai, che è il valore predefinito. A quell'ora la TV si spegne come con il tasto di accensione, se è accesa; un minuto prima compare un avviso sullo schermo. Lo spegnimento è gestito dal servizio TV di Cinema, quindi funziona anche mentre si usa un'altra app.
- Utile se la presa della TV ha un timer: impostando lo spegnimento qualche minuto prima che il timer tolga la corrente, la TV è sempre già spenta in modo pulito e non rischia di finire nella modalità di emergenza di Homebrew Channel.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.2.2_all.ipk` e webOS Dev Manager o `ares-install`.

## Verifiche

92 test JavaScript e 12 Python. Provata su una LG 43UN70006LA con webOS 5.6.2: con lo spegnimento fissato due minuti più avanti, la TV ha mostrato l'avviso e si è spenta all'orario; l'orario delle 2:00 scelto dalla scheda TV è stato salvato e il servizio lo usa.

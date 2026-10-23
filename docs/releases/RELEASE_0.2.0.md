# Cinema 0.2.0

Una scheda TV nelle Impostazioni per avere più memoria, meno pubblicità e il telecomando come vuoi tu; una barra delle app nuova con gli ingressi HDMI; Cinema che resta davanti anche dopo l'accensione.

## Cosa cambia

- **Barra delle app estesa.** Una fila a tutta larghezza di riquadri uguali, con il nome sempre visibile e gli ingressi HDMI come riquadri, attenuati quando non c'è segnale. La barra compatta di prima resta disponibile in Impostazioni → App.
- **Impostazioni → TV.** Su una TV con root, tutto ciò che la TV permette e niente di più:
  - aggiornamenti di Cinema e Bloomee dalle release su GitHub, verificati con SHA-256, con un avviso al giorno quando esce una versione nuova;
  - Cinema e Bloomee tenute aperte quando si apre un'altra app;
  - le app che LG carica in background, da spegnere una per una;
  - ID pubblicitario, Live Plus e promozioni tenuti spenti, anche quando LG li riaccende;
  - i servizi LG di analisi dei contenuti, log e suggerimenti fermati a ogni avvio;
  - i tasti del telecomando (Netflix, Prime Video, colori, Guida, Info…) assegnabili a Cinema, Bloomee, un ingresso o un'app;
  - gli accordi sui dati accettati con LG, con un interruttore ciascuno, che resta spento anche dopo il riavvio.

  **Ripristina tutto come LG** annulla tutto in un colpo.
- **Spegnimento dal salvaschermo.** Dopo 1-8 ore di salvaschermo di Cinema senza tasti premuti la TV va in standby; un film o un'app in uso non vengono mai interrotti.
- **Cinema resta davanti.** All'accensione LG rimetteva in primo piano l'ultimo ingresso usato una ventina di secondi dopo che Cinema era già comparsa, ed era il motivo per cui a volte la barra non si vedeva: ora Cinema torna davanti da sola, all'avvio e al risveglio dallo standby.

## Installazione

Scarica `org.webosbrew.lounge.launcher_0.2.0_all.ipk` e installalo con webOS Dev Manager o `ares-install`. Da questa versione in poi gli aggiornamenti si installano anche da Impostazioni → TV.

## Verifiche

91 test JavaScript e 10 test Python. Provata su una LG 43UN70006LA con webOS 5.6.2: ogni funzione attivata dalla scheda TV e annullata di nuovo, il tasto blu assegnato a HDMI 2 che apre HDMI 2, l'aggiornamento di Bloomee dalla release, lo spegnimento e il risveglio della TV, e un riavvio completo dopo il quale tutto era ancora applicato con Cinema in primo piano.

## Crediti

Gli Strumenti TV adattano tecniche di Glasshouse e TV Tools (entrambi MIT); la barra estesa si ispira a Minimal Home.

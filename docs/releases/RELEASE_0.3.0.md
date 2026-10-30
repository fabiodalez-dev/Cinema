# Cinema 0.3.0

Una revisione completa pensata per la TV su cui Cinema gira davvero: parte più in fretta, occupa un terzo dello spazio, regge meglio gli imprevisti di avvio, aggiornamenti e corrente, e si legge meglio dal divano.

## Più veloce

- **Avvio in mezzo secondo.** Sulla LG di prova la pagina è pronta in circa 500 ms invece di 3,4 secondi. Il dock salvato risponde subito al telecomando, mentre sfondo, ingressi e app si caricano in parallelo invece che uno dopo l'altro.
- **Pacchetto da 5,4 MB invece di 17.** Gli sfondi inclusi sono quelli a 1920 pixel, come lo schermo; le versioni 4K e la musica d'ambiente si scaricano solo quando servono.
- **Copertine Jellyfin fuori dalla memoria delle impostazioni.** Le immagini stanno in un archivio dedicato invece che come testo nelle preferenze: lo spazio usato scende da 822 a 110 KB e Cinema non rilegge più centinaia di KB a ogni avvio. Le copertine sono richieste alla risoluzione giusta per lo schermo e scaricate solo quando ci si ferma su un titolo.
- **Meno lavoro in sottofondo.** Il controllo dell'app in primo piano passa da ogni 3 a ogni 15 secondi, la musica si ferma appena si esce da Cinema, l'orologio scatta al minuto esatto, gli sfondi si alternano in dissolvenza senza schermo nero.

## Più robusta

- **Le operazioni root non si bloccano a vicenda.** Cambio canale, apertura di un titolo e lettura delle app passano davanti ai lavori lunghi (diagnostica, servizio TV, aggiornamenti), che ora girano staccati. Un comando che non risponde viene chiuso davvero allo scadere del tempo.
- **Aggiornamenti con ritorno indietro.** Prima di installare una nuova versione Cinema conserva quella in uso; se l'installazione non riesce la rimette al suo posto. Il pacchetto viene scaricato e controllato su disco, non in memoria.
- **Avvio e risveglio rispettano le tue scelte.** Dopo l'accensione Cinema torna davanti quando LG riapre da sola l'ultimo ingresso, ma non quando sei tu ad aprire Live TV o una fonte HDMI.
- **Spegnimento programmato sicuro.** Non scatta nei primi dieci minuti dopo l'accensione né finché l'orologio della TV non è affidabile, e la notte del cambio d'ora non salta.
- **Uscita dalla modalità di emergenza con preavviso.** Se la TV va riavviata per completare l'avvio, un messaggio lo annuncia un minuto prima e il riavvio aspetta se stai guardando qualcosa.
- **Il guardiano di Homebrew Channel si installa da solo** e parte a ogni avvio; disinstallando Cinema, servizio TV e collegamenti si tolgono da soli.
- **Impostazioni al sicuro.** Impostazioni illeggibili vengono conservate invece di essere sovrascritte, un salvataggio rifiutato per memoria piena viene segnalato, e gli aggiornamenti non riaccendono più la musica o riempiono il dock di app tolte.

## Nuove funzioni

- **Collegamento a Jellyfin dalla TV.** In Impostazioni → Cinema si inserisce l'indirizzo del server e si collega l'account con Quick Connect, approvando il codice dal telefono. Nessun accesso via SSH.
- **Continua a guardare con i prossimi episodi**, aggiornato da solo ogni dieci minuti.
- **Banner di Live più ricco:** barra di avanzamento del programma e tasti Info e Guida per riaprirlo.
- **Comandi vocali in italiano:** "apri Netflix", "vai su YouTube", "metti la TV".
- **Interfaccia tutta in italiano**, compresi assistente, meteo, backup e messaggi.

## Più leggibile dal divano

Testi più grandi (almeno 18 pixel), contrasto più alto sulle scritte secondarie, cornice di selezione più spessa, barra delle app più lontana dal bordo, data scritta all'italiana ("Venerdì 30 ottobre"), schermata di avvio scura e animazioni che si spengono tutte con l'opzione apposita.

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.0_all.ipk` e webOS Dev Manager o `ares-install`.

## Verifiche

129 test JavaScript e 34 Python. Provata su una LG 43UN70006LA con webOS 5.6.2: cinque avvii a freddo, aggiornamento dalla 0.2.3, due riavvii completi e un risveglio dallo standby con Cinema sempre in primo piano; cambio canale mentre un'operazione root lunga era in corso; archivio delle copertine, Quick Connect verso il server e download da jsDelivr dalla TV; backup per il ritorno indietro con il Python 2.7 della TV.

## Limiti noti

L'assistente vocale richiede Python 3.7-3.12, che questa TV non ha: Cinema ora lo dice una volta invece di riprovare a ogni avvio. Il ritorno indietro automatico è stato provato a pezzi ma non ancora con un aggiornamento reale fallito. Una volta, subito dopo la primissima installazione, la pagina ha occupato molta memoria; non si è più ripetuto.

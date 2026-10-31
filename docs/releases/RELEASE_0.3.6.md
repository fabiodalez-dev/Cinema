# Cinema 0.3.6

All'accensione è LG stessa ad aprire Cinema, verso i 30 secondi e senza passare dalla TV.

## Cosa cambia

- **Cinema come prima app.** Con «Apri Cinema all'accensione» il gestore di avvio di LG apre Cinema come farebbe con un'app di streaming: dopo il logo di LG compare Cinema, verso i 30 secondi. Nella 0.3.5 c'erano due secondi di nero e poi Live TV fino a 42 secondi.
- **Il salvaschermo di LG chiede prima a Cinema.** Con Cinema davanti e il suo salvaschermo acceso, quello di LG non parte. Con un'altra app davanti tutto resta come prima.
- **Una via di fuga.** Se Cinema si blocca, tre pressioni brevi di Home entro due secondi aprono la Home di LG. Lo stesso fa Indietro tenuto premuto per più di un secondo e poi lasciato, con Cinema davanti.
- **Blocco degli aggiornamenti di LG** in Impostazioni → TV. È l'opzione di Homebrew Channel: un aggiornamento del software LG può togliere il root. Blocca anche gli aggiornamenti di sicurezza e vale dal riavvio successivo.
- **Spaziature corrette sulla TV.** Venti gruppi di elementi, soprattutto in Impostazioni, avevano gli elementi attaccati, perché il browser della TV ignora `gap` nei contenitori flex. Ora la spaziatura è fatta con i margini, e un test impedisce di reintrodurla.

## Come funziona

Il file dell'ultimo ingresso nomina Cinema come ingresso di tipo app (`MVPD_IP`), il formato che il servizio degli ingressi di LG scrive da solo. Il gestore di avvio lo tratta come un'app di streaming e lancia la Cinema vera come prima app. A fine avvio LG riapre l'app scritta in due impostazioni di sistema, che dopo una serata di TV valgono Live TV: il servizio TV di Cinema le rimette su Cinema allo spegnimento e all'accensione. Il filtro dei tasti della 0.3.5 resta come riserva. La via di fuga legge i tasti dal kernel senza toglierli a LG. Dettagli nel README, sezione «Cosa ho imparato su questa TV».

## Installazione

Da Impostazioni → TV → Aggiornamenti, oppure con `org.webosbrew.lounge.launcher_0.3.6_all.ipk` e webOS Dev Manager o `ares-install`. Dopo l'aggiornamento, apri Impostazioni → TV e premi Salva, oppure riavvia la TV: così il servizio TV prende la versione nuova.

## Verifiche

139 test JavaScript e 48 Python. Provata su una LG 43UN70006LA con webOS 5.6.2:

- **Avvio completo**, anche partendo da Live TV come ultima app: logo di LG, Cinema visibile a 30 secondi, e Cinema ancora davanti a 66, 70, 72, 74, 76 e 80 secondi, cioè oltre la fine dell'avvio di LG.
- **Spegnimento e risveglio**: allo spegnimento il servizio rimette Cinema come ultima app, e al risveglio Cinema è davanti.
- **Via di fuga**: tre pressioni di Home e Indietro tenuto premuto, scritte come eventi veri nel dispositivo del telecomando, aprono la Home di LG.
- **Spaziature**: posizioni identiche al progetto in un browser moderno per tutti i contenitori, e misurate sulla TV in Impostazioni.
- **Salvaschermo**: la registrazione presso LG riesce; una richiesta vera di salvaschermo durante la prova non è arrivata, perché la TV si è riavviata da sola a metà.

## Limiti noti

Su una TV con tutti gli HDMI occupati il file dell'ultimo ingresso nomina Live TV come ingresso fisico, e a fine avvio LG può riaprirla per qualche secondo. La via di fuga apre la Home di LG una volta: il tasto Home successivo riapre Cinema.

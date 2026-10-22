# Cinema

Una Home per TV LG webOS con interfaccia ispirata a Google TV, icone native e libreria Jellyfin. Progettata per essere leggibile dal divano e navigabile con il telecomando, anche su TV con risorse limitate.

## Cosa offre

- Film, serie, riprendi visione e album musicali Jellyfin, con cache e una Home locale sempre utilizzabile.
- Live TV subito dietro ai controlli, selezione delle fonti e passaggio alla visione a schermo intero.
- Scopri e richieste tramite Litefin e il servizio Seerr già configurato sul server.
- Impostazioni a schermo intero: categorie con icone, righe grandi, interruttori e focus leggibile.
- Preferenze Cinema per animazioni, sfondi Jellyfin, ombra dei titoli Live e gestione dell’interfaccia.
- App e dock personalizzabili, sfondi, profili, musica ambiente, meteo, salvaschermo, backup, diagnostica e assistente vocale opzionale.

**Home** apre Cinema quando la rimappatura è configurata. Il **tasto giallo** alterna Cinema e vista essenziale. **Salva** applica le preferenze; **Chiudi** scarta le modifiche non salvate. Le animazioni sono brevi, disattivabili e rispettano il movimento ridotto.

## Build

```sh
npm ci
npm test
npm run pack
```

Il pacchetto mantiene l’ID applicazione esistente per conservare aggiornamenti, configurazione e hook. Non installare aggiornamenti di un’altra distribuzione se vuoi mantenere questa interfaccia.

[CINEMA.md](CINEMA.md) descrive configurazione, integrazione Jellyfin/Litefin, avvio e tasto Home. [VALIDATION.md](VALIDATION.md) riporta le verifiche sulla TV e i loro limiti.

Le credenziali rimangono sul dispositivo o sul server, fuori da sorgenti, pacchetto e backup delle preferenze Cinema.

## Origine e licenze

Basato su [gprot42/webos-launch-home](https://github.com/gprot42/webos-launch-home). La licenza originale è conservata in [LICENSE](LICENSE); altre attribuzioni e licenze degli asset sono indicate nei sorgenti e in CINEMA.md.

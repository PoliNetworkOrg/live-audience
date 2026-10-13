# Giochi — specifica tecnica

Riutilizzare memory-quiz per cinque giochi: campi opzionali answerMode (choice/order),
choices pubbliche, acceptedAnswers private. Config vecchi restano validi e identici
per il pubblico. Validare scelta/permutazione sul server; ordinamento con pulsanti
su/giù utilizzabili da tastiera. Match e vittoria atomica esistenti restano invariati.

Aggiungere number-estimate con prompt e target privato 0–1.000.000. Numero intero
entro gli stessi limiti. Seguire la UI esistente del numero per nome/numero, con limiti 0–1.000.000 e
editor del target. La preview mostra solo il vincitore e il dato reale. Persistenza in settings
number-draw:<id>, come il lotto; risultati esportano solo vincitore e numero scelto,
conteggio dei pari merito e distanza, senza elenco degli altri partecipanti. Config
bloccata dopo risposte per evitare cambi del target. Nessuna migrazione/dipendenza.

API /draw esistente, stage globale, SSE e autenticazione invariati. SDK documentato.
Live valida le attività effettivamente presenti nelle slide. Controller quiz supporta
foto sfocata o maschera HTML; nessuna alterazione raster. Soluzione fa comparire foto
nitida/completa. Controller stima mostra dato reale e vincitore con coriandoli.

Test: scelte/permutazioni invalide rifiutate, retrocompatibilità config testo, soluzione
privata; stima valida/limiti, vuoto, idempotenza, reset, config bloccata, risultati senza
identità; browser per sei slide, vittoria/reload e UI scelte/ordine/stima; checker di
layout per entrambe le presentazioni; typecheck/check/test/build dell'app.

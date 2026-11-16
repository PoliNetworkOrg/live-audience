# Conferma del regalo — specifica tecnica

Estendere il tipo esistente senza nuove dipendenze. `confirmationDueAt` è un istante ISO opzionale con default vuoto, compatibile con le configurazioni esistenti. La mezzanotte successiva si calcola in Europe/Rome con Intl; nessun offset UTC fisso.

Lo Store conserva conferme, avvisi e rimozioni in settings per attività, come estrazioni e notifiche esistenti. Le rimozioni conservano solo nome, email, motivo, istante e stato della notifica, per mostrare il motivo al proprietario anche dopo la cancellazione della risposta. Reset e annullamento del sorteggio eliminano lo stato del giro. Nessuna migrazione SQL necessaria.

POST autenticato `/api/secret-santa/:id/confirm-gift`: richiede iscrizione attiva, sorteggio e destinatario; rifiuta la conferma a partire dalla mezzanotte. È idempotente. I dati di conferma non escono attraverso la API key.

Il job esistente prepara avvisi dopo la scadenza, ritenta invii falliti e, a mezzanotte, rimuove in una transazione tutti i non confermati. Confronta il ciclo iniziale e quello finale per notificare soltanto i superstiti interessati. La conferma dei superstiti è conservata. Avvisi diventati obsoleti vengono ignorati.

Live invoca un endpoint email dedicato del backend tramite credenziale condivisa opzionale e HTTP o HTTPS (HTTP supportato anche per il collegamento sulla rete interna). Il backend valida tipo, destinatario e dati, limita il corpo e usa il mailer esistente; errori di invio non vengono riconosciuti come successi. Sviluppo senza credenziale usa il log, senza invii reali. Nessuna credenziale viene creata o pubblicata da questa implementazione.

Le mail di avviso/rimozione riutilizzano il layout natalizio del backend. La mail di riassegnazione distingue ritiro volontario da mancata conferma e non rivela il nuovo destinatario.

Verifica: test Store/API con orologio controllato e database in memoria; job con mailer simulato, retry e riavvio; transizioni all'istante limite; CET/CEST; conferme mantenute dopo ricucitura; errori e autenticazione del trasporto; rendering HTML/testo dei template; UI con API simulate. Nessun test invia mail o modifica produzione.

## Pannello organizzatori

Estendere solo le rotte protette admin. La vista restituisce destinatari, iscrizioni, conferme e riepiloghi,
oltre a una revisione calcolata sullo stato dei partecipanti, sorteggio, conferme, rimozioni e configurazione.
Le nuove mutazioni richiedono revisione attesa e motivo; conflitti ritornano 409. Gli abbinamenti inviati
devono includere esattamente i partecipanti attivi e formare un unico ciclo senza autoassegnazioni o
destinatari duplicati (nessuna assegnazione nel caso vuoto/singolo). Il salvataggio e le notifiche sono atomici.

Una migrazione aggiunge la cronologia degli interventi manuali, privata e legata all'attività. Nessun
nuovo pacchetto o servizio. La mail di riassegnazione aggiunge il motivo `admin`. Test: permessi e assenza
di dati privati nelle altre API; modifiche valide/invalide e concorrenti; conferme mantenute; notifiche
solo per i destinatari effettivamente cambiati; cronologia persistente e accessibile solo agli admin.

## Riammissione e correzione letterine

Nessuna migrazione SQL: lo stato vive in settings. `santa-archived:<id>` è una mappa
userId → `{ name, email?, entry, reason: "withdrawn" | "unconfirmed" | "admin", at }`, scritta da
`removeSecretSantaEntries` nella stessa transazione della rimozione, per ogni motivo e prima o dopo il
sorteggio. `joinSecretSanta` la cancella per chi si reiscrive (stessa transazione), il reset/eliminazione
(`deleteSecretSantaDraws`) la svuota, `undoSecretSantaDraw` la conserva. I vecchi record `santa-removed`
senza letterina compaiono con `entry: null`. `santa-letter-edited:<id>` (userId → istante) è svuotato da
reset e annullamento del sorteggio.

La vista admin aggiunge `formerParticipants` (unione di archivio e `santa-removed`, esclusi gli attivi,
dal più recente) e `counters.former`; la revisione copre anche archivio e correzioni delle letterine.

`POST /api/admin/secret-santa/:id/participants/:userId/readmit` (`readmitSecretSantaParticipant`) e
`PATCH /api/admin/secret-santa/:id/participants/:userId/entry` (`updateSecretSantaEntry`) richiedono
revisione e motivo come le altre correzioni e restituiscono la vista admin. La riammissione dopo il
sorteggio inserisce la persona dopo il donatore scelto e verifica che il risultato sia un unico ciclo
senza autoassegnazioni; le notifiche riusano `santa-reassign` con motivo `admin` e le regole di
deduplicazione delle correzioni degli abbinamenti. Tutte le scritture e la riga di cronologia
(«Riammissione», «Letterina») sono in un'unica transazione. La vista del partecipante espone
`match.editedAt` solo per il proprio destinatario.

Dopo la scadenza, se il donatore scelto non aveva nessuno (riceve un destinatario con la riammissione e
non poteva aver confermato), `confirmed: true` registra in `santa-confirmed` anche lui, con una riga
«Conferma regalo» in più; altrimenti il job della mezzanotte lo rimuoverebbe. Archivio e rimozioni sono
oggetti letti da JSON: le ricerche per `:userId` usano `Object.hasOwn`, così chiavi ereditate come
`constructor` o `__proto__` restituiscono 404. Dati personali nella cronologia
(`secret_santa_admin_actions`, persistente e non svuotata dal reset): nome di chi agisce, nomi dei
partecipanti coinvolti, motivo, abbinamenti, stato della conferma e adesione al gadget. Il testo delle
letterine non viene mai salvato: le righe «Cose che ama»/«Meglio di no» riportano solo «Testo
precedente», «Testo aggiornato» o «Vuoto».

Test (`tests/secret-santa-admin.test.ts`): archivio per ogni motivo, pulizia con reiscrizione/reset e non
con annullamento; riammissione prima del sorteggio, dopo con donatore normale, senza destinatario e
senza attivi; ciclo unico; scadenza; conferme; notifiche e mail del sorteggio con mailer simulato;
record legacy; permessi, revisioni superate, 404/409; rollback; correzioni con cronologia, no-op,
`editedAt` visibile solo al donatore e assenza di dati privati nelle API delle presentazioni.

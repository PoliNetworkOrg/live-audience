# Conferma del regalo — specifica tecnica

Estendere il tipo esistente senza nuove dipendenze. `confirmationDueAt` è un istante ISO opzionale con default vuoto, compatibile con le configurazioni esistenti. La mezzanotte successiva si calcola in Europe/Rome con Intl; nessun offset UTC fisso.

Lo Store conserva conferme, avvisi e rimozioni in settings per attività, come estrazioni e notifiche esistenti. Le rimozioni conservano solo nome, email, motivo, istante e stato della notifica, per mostrare il motivo al proprietario anche dopo la cancellazione della risposta. Reset e annullamento del sorteggio eliminano lo stato del giro. Nessuna migrazione SQL necessaria.

POST autenticato `/api/secret-santa/:id/confirm-gift`: richiede iscrizione attiva, sorteggio e destinatario; rifiuta la conferma a partire dalla mezzanotte. È idempotente. I dati di conferma non escono attraverso la API key.

Il job esistente prepara avvisi dopo la scadenza, ritenta invii falliti e, a mezzanotte, rimuove in una transazione tutti i non confermati. Confronta il ciclo iniziale e quello finale per notificare soltanto i superstiti interessati. La conferma dei superstiti è conservata. Avvisi diventati obsoleti vengono ignorati.

Live invoca un endpoint email dedicato del backend tramite credenziale condivisa opzionale e HTTPS (HTTP solo localhost). Il backend valida tipo, destinatario e dati, limita il corpo e usa il mailer esistente; errori di invio non vengono riconosciuti come successi. Sviluppo senza credenziale usa il log, senza invii reali. Nessuna credenziale viene creata o pubblicata da questa implementazione.

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

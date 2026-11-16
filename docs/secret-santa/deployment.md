# Messa online del Secret Santa

## 1. Pubblicare il backend delle email

Unire e rilasciare prima la PR del backend: Live usa i nuovi tipi di notifica per conferme,
rimozioni e correzioni degli organizzatori.

Configurare nel backend:

- `LIVE_MAILER_TOKEN`: un segreto casuale dedicato al collegamento con Live.
- `LIVE_PUBLIC_URL`: `https://live.polinetwork.org` (oppure l'origine pubblica effettiva).
- Le credenziali del provider email già usato dal backend devono essere operative.

L'endpoint è `POST /internal/secret-santa/emails`, autenticato con il token condiviso.
Non inserire il segreto nel repository, nei log o nelle PR.

## 2. Preparare e pubblicare Live

Prima del rilascio fare un backup coerente del database SQLite e del relativo volume.
Mantenere una sola replica di Live. Le nuove migrazioni partono automaticamente all'avvio;
non modificare a mano il numero di versione del database.

Configurare:

- `PUBLIC_URL=https://live.polinetwork.org`.
- `MAILER_URL=https://<host-backend>/internal/secret-santa/emails`.
- `MAILER_TOKEN`: lo stesso valore di `LIVE_MAILER_TOKEN` del backend.
- OIDC issuer, client ID e client secret della registrazione di Live, con scope
  `openid profile email polinetwork:identity` e redirect `/auth/callback` sull'origine pubblica.
- Permesso IdP `live-audience:admin` per gli organizzatori.
- `DATABASE_PATH` sul volume persistente; `DEV_LOGIN` disabilitato.

Unire la PR Live in main. Il workflow del repository pubblica l'immagine
`ghcr.io/polinetworkorg/live-audience:latest`; aggiornare il servizio che la esegue con il nuovo digest.
La creazione della PR o dell'immagine da sola non aggiorna un container già in esecuzione.
Verificare che `/healthz` risponda `ok`, che il volume sia montato e che gli amministratori accedano.

## 3. Attivare l'evento

Nel pannello admin creare/configurare il Secret Santa: visibilità, iscrizioni, chiusura,
estrazione, luogo/data dello scambio, budget e scadenza di conferma del regalo.
Controllare le date prima di rendere visibile l'attività. Evitare di pubblicare dati di prova.

Alla scadenza di conferma parte l'ultimo avviso; i non confermati hanno tempo fino alla
mezzanotte dello stesso giorno in Europe/Rome. Da mezzanotte vengono rimossi e il ciclo
viene ricucito. Non impostare una scadenza passata per un evento che deve ancora iniziare.

La modalità Natale si attiva dall'interruttore nell'intestazione admin e vale per la home di tutti.
La pagina Secret Santa mantiene sempre il suo tema. L'estrazione del gadget resta sospesa:
si raccolgono soltanto le adesioni.

Controllare che gli iscritti abbiano un indirizzo email: il pannello segnala quelli senza.
Dopo l'estrazione controllare contatori, conferme e stato delle email; monitorare errori di invio
nel backend e in Live. Senza configurazione mail Live usa il log e non recapita email.

## Recupero

In caso di problemi mettere temporaneamente in pausa le nuove iscrizioni e valutare lo stato
nell'admin prima di annullare un'estrazione: annullarla cancella conferme e notifiche del giro,
ma non ritira le email già inviate. Per un ripristino del database fermare Live e usare il backup
coerente con la versione applicativa scelta; conservare una copia dello stato corrente.

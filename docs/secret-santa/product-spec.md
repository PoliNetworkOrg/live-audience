# Conferma del regalo — specifica prodotto

Stato: implementato e verificato. Regole approvate il 14 novembre 2026.

- Il gadget raccoglie solo adesioni. Estrazione e visualizzazione dei vincitori sono sospese; le adesioni e le vecchie estrazioni restano conservate.
- Dopo l'estrazione del Secret Santa compare la data entro cui confermare «Ho preso il regalo». La conferma riguarda acquisto o preparazione, non consegna.
- Alla scadenza configurata chi non ha confermato riceve un ultimo avviso con un collegamento al sito. Può confermare fino alla mezzanotte dello stesso giorno in Europe/Rome.
- Dalla mezzanotte la conferma viene rifiutata, gli iscritti non confermati vengono rimossi e il ciclo viene ricucito. Le rimozioni dello stesso giro vengono applicate insieme, notificando solo le riassegnazioni definitive.
- Il rimosso vede il motivo sul sito e riceve una mail. La mail dice «non hai confermato», senza presumere che non abbia effettivamente comprato il regalo.
- Le persone riassegnate ricevono una mail, conservano l'eventuale conferma già data e vedono il destinatario aggiornato solo dopo il login.
- Il collegamento nella mail apre il sito; la conferma richiede un pulsante autenticato. Aprire una mail o visitare un URL non modifica dati.
- Ritiri volontari e letterine bloccate dopo l'estrazione restano disponibili come prima. Se resta una sola persona non viene assegnata a sé stessa; il sito e la notifica rimandano agli organizzatori.

Accettazione: iscrizione gadget senza estrazione/biglietto; conferma persistente e solo propria; scadenze italiane anche durante cambi d'ora; tolleranza fino a mezzanotte; rimozione visibile e non reiscrivibile dopo il sorteggio; ciclo valido dopo rimozioni contigue/totali; notifiche ritentate senza duplicazioni ordinarie; nessuna coppia o email nelle API delle presentazioni.

## Gestione degli organizzatori

Nuovo requisito: gli admin vedono tutti gli abbinamenti, le letterine e gli stati, per gestire casi particolari.
Il limite «ognuno vede solo il proprio destinatario» resta valido per i partecipanti. L'API delle presentazioni
continua a esporre solo contatori aggregati.

Il pannello mostra iscritti attivi, confermati, da confermare, senza destinatario, rimossi e adesioni gadget,
con ricerca e filtri. Gli organizzatori possono correggere abbinamenti e conferme e rimuovere partecipanti.
La conferma già data viene mantenuta quando cambia il destinatario. Le modifiche agli abbinamenti
sono applicate insieme, previa anteprima, motivo e controllo che il ciclo resti valido. Le persone
coinvolte vengono avvisate con una mail che parla di intervento degli organizzatori, senza inventare un ritiro.

Gli interventi manuali registrano autore, data e motivo. Un salvataggio da una schermata superata viene
rifiutato e richiede di ricaricare, preservando le modifiche effettuate da un altro organizzatore o dal job.

## Riammissione e correzione delle letterine

Decisione presa il 16 novembre 2026: gli organizzatori possono riammettere chi si è ritirato o è stato
rimosso (dagli organizzatori o per mancata conferma) e correggere la letterina di un partecipante attivo.
Entrambe le azioni richiedono un motivo e compaiono nella cronologia degli interventi.

- Il pannello elenca le persone «Rimossi e ritirati» non più attive, con motivo e data. La letterina
  viene conservata a ogni uscita, prima o dopo il sorteggio. Per le rimozioni per mancata conferma
  avvenute prima di questa funzione la letterina non è stata conservata e va riscritta con la persona.
  I ritiri avvenuti prima di questa funzione non hanno lasciato traccia e non si possono riammettere.
- Chi si reiscrive da solo prima del sorteggio esce dall'elenco. L'elenco sopravvive all'annullamento
  del sorteggio e viene cancellato solo con il reset dell'attività.
- Prima del sorteggio la persona torna semplicemente iscritta, anche a iscrizioni chiuse.
- Dopo il sorteggio l'organizzatore sceglie chi farà il regalo alla persona riammessa (G). G regala
  alla persona riammessa, che regala a chi aveva G; nessun altro abbinamento cambia. Se G non aveva
  nessuno, i due si fanno il regalo a vicenda; se non c'è nessun partecipante attivo, la persona torna
  senza destinatario.
- Dopo la mezzanotte della scadenza di conferma la riammissione con un destinatario richiede di
  segnare il regalo come già preso, altrimenti il job la rimuoverebbe di nuovo. Se G non aveva nessuno,
  con la riammissione riceve anch'esso un destinatario: la stessa conferma vale anche per G. Senza
  questa scelta un'eventuale vecchia conferma viene annullata.
- G riceve la mail di intervento degli organizzatori se aveva già ricevuto la mail del sorteggio. La
  persona riammessa riceve la stessa mail se aveva già ricevuto quella del sorteggio, altrimenti la
  normale mail del sorteggio.
- La cronologia degli interventi resta anche dopo il reset, quindi non conserva il testo delle
  letterine: registra solo quale campo è cambiato («Testo precedente» → «Testo aggiornato», «Vuoto»)
  e l'adesione al gadget (Sì/No).
- La correzione della letterina non invia email. Dopo il sorteggio chi fa il regalo vede sul
  cartellino «Letterina aggiornata dagli organizzatori il <data>»; nessun altro lo vede.
- Archivio, letterine e abbinamenti restano fuori dall'API delle presentazioni e dalle viste degli altri partecipanti.

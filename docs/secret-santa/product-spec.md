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

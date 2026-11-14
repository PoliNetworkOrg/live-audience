# Conferma del regalo — roadmap

1. Salvare il lavoro natalizio precedente in un commit locale: completato, `162833d`.
2. Estendere configurazione, stato privato, endpoint di conferma e job; testare scadenze e rimozioni in blocco.
3. Aggiungere configurazione admin, stato confermato/rimosso e conferma sul sito. Sospendere estrazione e biglietto del gadget, mantenendo le adesioni.
4. Collegare Live al mailer del backend e aggiungere template e test senza invii reali.
5. Eseguire typecheck, lint, test, build, verifica UI e revisione; creare i commit finali nei repository interessati. Nessun push, PR o deploy.

Implementazione completata. Live: typecheck, Biome, 65 test e build superati anche con Node 26
(compatibile con il requisito Node >=24). Backend: typecheck, controlli sui file modificati,
build e suite completa superati; 11 integrazioni opzionali non abilitate. Verifiche Chromium
con API simulate a 320, 390 e 1280 px: conferma, persistenza, errori, scadenza, rimozione,
collegamento alla sezione e assenza di vincitori del gadget. Test di invio con provider simulato,
nessuna email reale spedita.

Attivazione: configurare MAILER_URL/MAILER_TOKEN su Live e LIVE_MAILER_TOKEN/LIVE_PUBLIC_URL sul backend
prima di abilitare una scadenza di conferma in produzione. In locale rimane il mailer di log.

## Pannello organizzatori

1. Riepiloghi e vista completa degli abbinamenti, riservati agli admin.
2. Correzione atomica del ciclo e delle conferme, revisioni per concorrenza e cronologia degli interventi.
3. Pannello operativo con ricerca, filtri, anteprima e motivo delle correzioni.
4. Notifica degli interventi degli organizzatori, test API/UI e commit locali.
5. Riammissione e correzione letterine: in attesa della scelta di prodotto.

Passi 1–4 completati: API riservate agli admin, correzioni atomiche con revisione e cronologia,
pannello a larghezza piena e notifiche dedicate alle correzioni degli organizzatori. Live:
typecheck, Biome, 78 test e build superati. Backend: typecheck, controlli sui file modificati,
358 test e build superati; 11 integrazioni opzionali non abilitate. Verifica Chromium con API
simulate a 390 e 1280 px per filtri, conferme, anteprima del ciclo, salvataggio, cronologia,
concorrenza e conservazione delle bozze in caso di errore. Nessuna email reale inviata.

# Consegna: sei giochi dell’assemblea

Implementati vero/falso, intruso, foto misteriosa, cronologia, numero reale e oggetto
coperto. Le due presentazioni hanno 65 slide: giochi nuovi alle posizioni 14, 19, 27,
51, 54 e 63; ordine e contenuto delle slide preesistenti preservati.

Memory quiz supporta scelta e riordino con frecce oltre al testo libero. Il nuovo
number-estimate usa un target privato, risultati persistenti e sorteggio dei pari
merito. Nessuna dipendenza né migrazione. Attività locali create senza cambiare stage
o risposte esistenti; nessuna configurazione di produzione eseguita.

Verifiche: pnpm typecheck/check/test/build superati; 30 test, 7 file. Layout dei due
HTML verificato su 65 slide. Browser con API simulate: dodici giochi (sei per deck),
soluzioni nascoste, foto progressiva, maschera, coriandoli, duplicati SSE, reload chiuso,
rivelazione senza vincitore, movimento ridotto. UI telefono per scelte, ordine e stima.
Non è stato eseguito un test di partecipazione sul servizio pubblico.

Review locale con la checklist find-bugs: letti integralmente definizioni/UI quiz e
stima, registri, test aggiunti, integrazione Live/CSS e sei blocchi nuovi di ciascun
sorgente; letti Store e documentazione attinenti. Controllati injection/XSS (parametri
SQLite, React/textContent), autenticazione/autorizzazione/CSRF (route esistenti), gare
e idempotenza (scrittura sincrona/transazione), sessioni (invariate), casualità
(node:crypto), divulgazione (target e soluzioni esclusi dal config pubblico, solo
vincitore della stima esportato), limiti input/carico e logica di chiusura/reset.
Nessun problema significativo rilevato nello scope. Produzione non verificata.

Suggerimenti soltanto, nessuna operazione Git eseguita dall’agente:

- Branch: `feat/assemblea-prize-games`
- Conventional Commit: `feat: add six live audience prize games`
- Titolo PR: `Add six prize games throughout the assembly presentation`

Descrizione PR pronta:

Adds six prize games throughout both assembly decks: true/false, an odd project,
a progressively revealed photo, event ordering, guessing a real figure and a covered
photo detail. Live supports multiple-choice and ordering quizzes plus a private-target
number estimate with a persistent winner and random tie resolution. Quiz solutions
stay private from participants; existing slide content and responses are preserved.

Validation: typecheck, Biome, all 30 tests and build passed. Both 65-slide decks pass
layout checks. Browser checks cover all six games in both decks, phone inputs,
concealed/revealed media, winners, reloads, manual reveal and reduced motion using
mocked APIs. Public-service participation was not tested.

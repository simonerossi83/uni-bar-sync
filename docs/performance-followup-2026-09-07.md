# Ottimizzazioni per visitatori distribuiti — 7 settembre 2026

Scenario: circa 400 visitatori contemporanei che consultano e ordinano in momenti diversi, non 400 acquisti allo stesso istante. Piano gratuito invariato.

## Modifiche pubblicate

- Menu completo conservato circa cinque minuti; sole scorte/disponibilità ogni 20–30 secondi lato cliente, 4–6 in cucina. Il primo caricamento riusa la risposta completa senza una seconda richiesta scorte immediata.
- Stato privato tramite capability Supabase: polling 3–4,5 secondi in preparazione, 5–6,5 per ricevuti, 8–9,5 per pronti; termina al ritiro. Timestamp countdown persistito.
- Recupero token dalla sessione firmata al refresh; copia in memoria se localStorage è bloccato. Fallback legacy a circa 30 secondi per contenere consumo Worker.
- Cucina: una richiesta Worker ogni 3–4 secondi, pagine da 50 per stato con conteggi completi. Dettagli dei ritirati scaricati solo aprendo lo storico; tre code separate.
- Margine IP condiviso: 800 tentativi/5 minuti, invariati sei per sessione; attesa esplicita nel client quando scatta il limite.
- Limite carrello coerente di 20 per prodotto; blocco immediato doppi click ritiro e cancellazione del polling precedente al ritiro.
- Restore con blocchi nello stesso ordine degli acquisti; indice su `order_items.menu_item_id`. Nessuna modifica ai dati esistenti da parte della migrazione.

Avanzamento automatico ogni 10 secondi, interventi manuali, archiviazione con conferma, ritiro e controlli server mantenuti. Le skill Supabase/Postgres hanno guidato paginazione, indici e ordine dei blocchi senza duplicare l'architettura o indebolire RLS.

## Verifiche e limiti

TypeScript, lint mirato e build produzione superati. 14 test funzionali: 400 clienti distinti sulla stessa rete simulata, creazione e retry ciascuno; 400 ordini unici, stock esatto, otto pagine raggiungibili, avanzamento, token valido, ritiro e retry. Verificati anche autorizzazioni, stock insufficiente, restore, limiti, refresh e storage bloccato.

PGlite/pgcrypto ricreato dalle migrazioni reali; trasporto PostgREST e contesto cookie adattati solo nei test. Cron invocato manualmente. PGlite non simula 400 connessioni PostgreSQL parallele: questi test non certificano CPU/lock del provider. Altri quattro test di audit usano cookie cifrati reali; due riproducono il problema di revoca aperto nell'[audit sicurezza](security-audit-2026-09-07.md).

| Prova pubblica, senza modifiche ai dati | Richieste | Errori | p95 |
| --- | ---: | ---: | ---: |
| Menu, arrivi distribuiti a 20/s | 400 | 0 | 224,7 ms |
| Scorte, arrivi distribuiti a 20/s | 400 | 0 | 90,1 ms |
| 400 lettori stato, cadenza rapida 3–4,5 s | 687 prima dello stop | 118 timeout | circa 10 s |

Risposta scorte: 1867 byte decodificati contro 4877 del menu, circa 62% in meno per aggiornamento frequente, oltre al minor numero di aggiornamenti.

Il test estremo stato è stato interrotto dal criterio di sicurezza: 569 HTTP 200, 118 timeout. Usa token volutamente invalidi, non 400 ordini reali. Il precedente controllo aveva esito migliore: il risultato non è stabile e **non è superato**. Non attribuito con certezza a DB, rete del generatore o provider.

I controlli di consultazione distribuita sono positivi, ma non costituiscono certificazione di 400 ordini attivi in polling rapido o di durata illimitata entro quote gratuite. Resta utile un test prolungato a traffico misto con osservazione di CPU/quote. Nessun ordine fittizio generato sul backend pubblico.

## Pubblicazione

[Worker aggiornato](https://simonerossi83-uni-bar-sync.ro-saimon.workers.dev), versione `1ce22a1a-3d74-4ce7-a615-f866b041d40d`.

Migrazione applicata: `20260907081718_staggered_visitors_inventory_locking`, nome locale allineato al registro remoto. Home verificata con nuovo asset `index-DkIA7Hw9.js`; login, lettura autenticata della cucina paginata e logout browser verificati. Controllo remoto: 7 ordini, 23 righe, 420000 unità di stock invariati. Nessun cambio di piano, password o segreti. Ricaricare una volta le dashboard aperte prima del deploy per usare il nuovo bundle/API.

# Verifica di capacita: 400 utenti

Verifica del 7 settembre 2026, circa 09:40-09:50 Europe/Rome.

**Esito: 400 utenti contemporanei non ancora validati per l'intero flusso.**
Le letture distribuite nel tempo hanno superato il controllo. Il picco di nuove
connessioni ha prodotto timeout gia a 100 richieste, e il limite per IP non lascia
margine a 400 clienti sulla stessa rete. Non e stato eseguito un test di scrittura
con 400 ordini; nessun ordine o prodotto e stato modificato durante questa verifica.

Ambiente: app pubblica su Cloudflare Workers,
`https://simonerossi83-uni-bar-sync.ro-saimon.workers.dev`,
Supabase `sgziuagzvnmnzlqibgdo`, organizzazione confermata sul piano Free.
Gli asset della pagina pubblica corrispondono ai nomi del bundle gia pubblicato
(`index-CDqb3fhO.js`, `bar-DtWkqJk6.js`). Nessun nuovo deploy eseguito.

## Misure HTTP

Generatore: Node 24.13.1 su questa macchina Windows, una sola origine di traffico.
Timeout cliente 10 secondi; interruzione ai primi errori di fase o p95 oltre 5 secondi.
Il test a gradini avrebbe raggiunto 400 richieste, ma si e fermato a 100 per questa
soglia. Non e quindi corretto chiamarlo un test superato con 400 accessi simultanei.

| Prova | Richieste | Errori | p95 | Note |
| --- | ---: | ---: | ---: | --- |
| Homepage, picco di 25 | 25 | 0 | 291 ms | HTTP 200 |
| Menu, picco di 25 | 25 | 0 | 1.389 ms | HTTP 200 |
| Homepage, picco di 100 | 100 | 0 | 3.549 ms | HTTP 200 |
| Menu, picco di 100 | 100 | 5 timeout | 7.618 ms | Arresto automatico |
| Ripetizione menu, picco di 100 fuori sandbox | 100 | 7 timeout | 10.005 ms | Arresto automatico |
| Menu, 400 lettori distribuiti a 20 richieste/s | 400 | 0 | 79,5 ms | 20 s; massimo 4 richieste in volo |
| RPC stato, 400 lettori virtuali, 5 letture ciascuno | 2.000 | 0 | 74,7 ms | 22 s; massimo 30 richieste in volo; token volutamente invalido |
| Menu, 100 richieste accodate su 10 connessioni persistenti | 100 | 0 | 937 ms | Tutte concluse in circa 1,07 s |

Il test RPC restituisce correttamente `[]`: verifica il percorso di rifiuto del
token, non lo stato di un ordine autorizzato. Non verifica isolamento fra 400
sessioni, countdown, ritiro, aggiornamenti della cucina o idempotenza sotto carico.
Il test menu distribuito simula un ciclo di aggiornamento di 400 browser; non
equivale a 400 richieste eseguite nello stesso istante.

La forte differenza fra nuove connessioni e connessioni riutilizzate suggerisce
un limite nel percorso HTTP/connessioni del test. Non dimostra da sola un limite
del server Supabase: generatore, sistema operativo, rete, TLS e gateway restano
possibili fattori. Non e stato svolto un test distribuito da piu macchine.

## Stato del database

Dati rilevati tramite Supabase MCP e query di sola lettura:

- Progetto `ACTIVE_HEALTHY`, Postgres 17.6.
- Dimensione circa 25,2 MB; 7 ordini totali, 3 non archiviati, 23 righe ordine,
  21 prodotti. Questo dataset e piccolo: non rappresenta gia 400 ordini attivi.
- 6 connessioni al primo campionamento; `max_connections = 60`.
  I browser usano la Data API HTTP: non aprono ciascuno una connessione Postgres.
- Nessuna attesa su lock ai campionamenti; contatore deadlock pari a zero.
- Piano della SELECT menu: 21 righe, ordinamento in memoria, 0,211 ms di esecuzione.
  La scansione sequenziale di una tabella cosi piccola e normale.
- Statistiche aggregate della SELECT menu via PostgREST dopo le prove:
  923 chiamate, media 0,166 ms, massimo 5,810 ms. Sono statistiche cumulative,
  non il p95 dell'intera richiesta HTTP e non comprendono rete/TLS/attese del gateway.
- Cron automatico ogni 10 secondi: 60 esecuzioni riuscite negli ultimi 10 minuti,
  durata media circa 3,26 ms, con il dataset attuale.
- Indici presenti per ID ordine, righe per ordine, richiesta idempotente,
  ordini attivi e scadenza degli ordini in preparazione.
- Conteggi finali invariati: 7 ordini, 23 righe, somma scorte 420.000.

Le procedure di creazione bloccano i prodotti in ordine stabile e aggiornano le
scorte nella stessa transazione. E una buona protezione contro overselling e
deadlock fra creazioni, ma ordini sullo stesso prodotto devono attendere il lock.
Il ripristino scorte aggiorna piu prodotti senza lo stesso ordinamento esplicito:
va incluso nella prova concorrente insieme a creazione e avanzamento cron.

## Problemi e limiti da risolvere prima di dichiarare 400 utenti supportati

1. **Rate limit senza margine su Wi-Fi condiviso.** In `src/lib/bar.server.ts:86`
   il limite e 400 tentativi ogni 300 secondi per IP, consumati prima della RPC
   di creazione. Con 400 clienti, anche un solo nuovo tentativo o errore nel carrello
   puo far rifiutare un ordine legittimo. La richiesta duplicata consuma comunque
   quota prima di raggiungere l'idempotenza del database. Rivedere il margine
   mantenendo il limite per sessione e gestire chiaramente l'attesa nel frontend.

2. **Dashboard cucina senza paginazione.** `getKitchenOrders` in
   `src/lib/bar.server.ts:161` scarica tutti gli ordini non archiviati, comprese le
   righe prodotto e gli ordini ritirati, ogni 1,8-2,5 secondi. Il costo cresce fino
   all'azzeramento manuale. Con il limite API predefinito di 1.000 righe e l'ordine
   crescente, gli ordini nuovi potrebbero restare fuori dalla prima pagina.
   Il valore effettivo di Max Rows non e stato rilevato: 1.000 e il default
   documentato, non una configurazione remota accertata. Separare coda attiva e
   storico, introdurre paginazione e aggiornamenti piu piccoli.
   [Limite SELECT e paginazione Supabase](https://supabase.com/docs/reference/javascript/select).

3. **Polling ancora proporzionale agli utenti.** Il menu passa direttamente a
   Supabase ogni 15-25 s; lo stato ogni 3-4,5 s in preparazione e 4,5-6 s negli altri
   stati. Si ferma al ritiro o quando la scheda non e visibile. Le letture non
   consumano la quota Worker, ma consumano risorse e traffico Supabase.
   La cache di `getPublicMenu` lato server non e utilizzata dal nuovo percorso
   diretto. Valutare aggiornamenti di sola disponibilita e refresh adattivo.

4. **Fallback al Worker.** In `src/lib/bar.ts:225`, se manca il token in
   localStorage, ogni aggiornamento dello stato passa dal Worker. Succede anche
   per ordini precedenti all'introduzione del token. Molti clienti in fallback
   possono nuovamente consumare rapidamente la quota Cloudflare.

5. **Scritture e CPU non misurate a 400 utenti.** Ogni creazione fa due RPC di rate
   limit e una RPC di creazione in sequenza. Sotto lo stesso IP il contatore e una
   riga condivisa. I prodotti piu richiesti sono altri punti di serializzazione.
   Mancano misure di attesa sui lock, timeout, doppie richieste e CPU Worker durante
   creazione/ritiro. La riuscita della homepage non copre questi percorsi.

## Proiezione delle letture, non misura di capacita

Considerando intervalli uniformi e risposte rapide, 400 utenti sempre sulla stessa
schermata generano circa:

| Scenario | Richieste/s | Richieste/ora | Destinazione |
| --- | ---: | ---: | --- |
| 400 utenti sul menu | 20,4 | 73.559 | Supabase Data API |
| 400 ordini in preparazione | 108,1 | 389.247 | Supabase RPC |
| 400 ordini ricevuti/pronti | 76,7 | 276.175 | Supabase RPC |
| Una dashboard cucina, solo lista ordini | 0,47 | 1.689 | Cloudflare e Supabase |

I gruppi menu/preparazione/pronto sono scenari alternativi: non vanno sommati come
se fossero sempre tutti presenti. Le richieste effettive diminuiscono per latenza,
schede nascoste e ordini ritirati; errori/retry e riaperture possono aumentarle.
I campioni positivi del menu pesano 4.877 byte JSON decodificati e circa 1.430 byte
con gzip in una misura separata. Il solo menu costantemente aperto da 400 utenti
vale quindi circa 105 MB/ora di corpo HTTP compresso, a contenuto invariato.
E una stima di traffico del payload, non una misura della fatturazione o del consumo
mensile reale dell'organizzazione; mancano overhead e gli altri percorsi/progetti.

Cloudflare Free include 100.000 richieste dinamiche/giorno e 10 ms CPU/richiesta;
l'attesa delle chiamate di rete non conta come CPU.
[Limiti Cloudflare](https://developers.cloudflare.com/workers/platform/limits/).
Supabase Free include API senza quota numerica di richieste, ma risorse condivise
e 5 GB di egress. Il limite Realtime gratuito e 200 connessioni: un WebSocket per
ognuno dei 400 clienti non e un passaggio compatibile con quel limite. L'app
attuale usa polling HTTP, quindi quel limite Realtime non blocca questa versione.
[Piano Supabase](https://supabase.com/pricing),
[Egress Supabase](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

## Advisors e sicurezza del percorso di lettura

L'advisor prestazioni segnala una FK non indicizzata su `order_items.menu_item_id`:
e una priorita secondaria per questa verifica, perche il polling degli ordini usa
`order_items.order_id`, gia indicizzato.
[Dettaglio advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
Gli indici segnalati come non usati non vanno rimossi solo sulla base di un dataset
di 7 ordini.
[Advisor indici inutilizzati](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Gli advisor sicurezza segnalano intenzionalmente la RPC `SECURITY DEFINER`
eseguibile da anon/authenticated. La funzione verificata controlla ID e hash del
token e restituisce solo lo stato. Non e un endpoint di modifica, ma e direttamente
raggiungibile e non passa dal rate limiter Worker; il test di token invalido non
costituisce un audit completo dell'autorizzazione.
[Advisor anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[Advisor authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
Le tabelle ordini, righe e rate limit hanno RLS senza policy pubbliche, coerente
con il blocco dell'accesso diretto e con il percorso server service-role.
[Advisor RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Riproduzione e passo necessario

Lo script legge solo configurazione pubblica da `.env`/`.env.local`, non stampa
chiavi e non usa service-role. Senza `--live` non effettua richieste.

```powershell
node scripts/check-capacity-readonly.mjs --live
node scripts/check-capacity-readonly.mjs --live --steady-only
```

Per confermare la capacita completa serve un ambiente isolato con dati sintetici:
400 sessioni, creazioni distribuite e a picco sulla stessa rete, stesso prodotto e
prodotti differenti, retry idempotenti, cron, ritiro e ripristino scorte concorrenti.
Misurare errori, p95/p99, CPU Worker, attesa lock, scorte e ordini duplicati, oltre a
un test prolungato. Il piano gratuito puo essere valutato con queste ottimizzazioni;
questa verifica non lo certifica per 400 acquisti simultanei.

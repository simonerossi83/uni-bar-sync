# Audit sicurezza — 7 settembre 2026

Esito: nessuna vulnerabilità critica dimostrata nei controlli eseguiti, ma **non è corretto dichiarare l'app priva di vulnerabilità**. È necessaria una correzione alla revoca delle sessioni cucina.

Ambito: sorgenti, dipendenze installate, bundle pubblico, privilegi Supabase effettivi, richieste HTTP al Worker e test isolati. Nessun ordine reale creato, ritirato o archiviato; nessun ripristino delle scorte reali. Eseguiti login/logout di verifica, con i normali aggiornamenti dei contatori di accesso. Nessun segreto stampato.

## Risultati aperti

### SEC-01 — Media: cambio password/logout non revocano una copia della sessione

Riferimenti: `src/lib/kitchen-auth.server.ts:32`, `:66`, `:108`.

La sessione cucina è un cookie cifrato/autenticato valido 12 ore. `isKitchenAuthenticated()` controlla solo il flag nel cookie: manca una versione delle credenziali o un registro delle sessioni revocate. Cambiare `KITCHEN_PASSWORD` lascia validi i cookie già emessi; il logout elimina il cookie dal browser ma non invalida una copia precedentemente sottratta.

Prerequisito: possesso di un cookie cucina valido, per esempio da un dispositivo compromesso. Non consente accesso senza credenziali/cookie e non dimostra furti in corso. La copia non revocata mantiene però tutti i poteri della cucina fino alla scadenza.

Riprodotto in `tests/security-session.audit.test.ts` usando le funzioni applicative e cookie cifrati della stessa libreria h3 della produzione. Due test documentano intenzionalmente il comportamento vulnerabile: il loro superamento **non** significa che sia risolto.

Correzione proposta: sessioni revocabili lato server, controllo della versione delle credenziali e revoca al logout. Ruotare l'attuale segreto condiviso invaliderebbe anche le sessioni clienti: valutarne prima l'impatto. [Indicazioni OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

### SEC-02 — Bassa: errori di autorizzazione dentro HTTP 200

Riferimenti: `src/lib/kitchen-auth.server.ts:139`, `src/lib/rate-limit.server.ts:13`, `src/lib/bar.ts:120`.

Verifica HTTP con payload correttamente serializzato: `fetchKitchenOrdersServer` senza cookie restituisce HTTP 200 con errore applicativo `Autenticazione cucina richiesta`, anziché 401. Il dato è protetto: **non è un bypass di autorizzazione**. Status errati rendono però meno affidabili monitoraggio e regole anti-abuso. Anche il risultato tipizzato di rate limiting ordine non imposta esplicitamente HTTP 429.

Proposta: mantenere il contratto RPC impostando anche gli status HTTP 401/403/409/429, con test a livello HTTP. La sola proprietà `statusCode` su `Error` non basta nella serializzazione TanStack.

### SEC-03 — Bassa / hardening: CSP non restrittiva sugli script

Riferimento: `src/start.ts:25`.

La policy effettiva è `frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Blocca il clickjacking ma non definisce `script-src`, `default-src` o `object-src`. Non è stata dimostrata una XSS: note e nomi sono testo React; il componente con `dangerouslySetInnerHTML` trovato è un grafico non usato dalle route.

Proposta: CSP con nonce/hash, prima report-only e verificata con SSR/hydration. Il token di sola lettura dello stato in localStorage sarebbe leggibile in caso di futura XSS. Non aggiungere una CSP rigida senza gestire gli script SSR: potrebbe rompere l'app.

### Limite anti-abuso degli ordini anonimi

Riferimenti: `src/lib/kitchen-auth.server.ts:123`, `src/lib/bar.server.ts:52`.

Sei tentativi per sessione non identificano una persona: eliminando il cookie si ottiene un nuovo identificativo. Resta attivo il limite separato per IP (800 tentativi/5 minuti, compatibile con Wi-Fi condiviso), ma un bot può consumare budget e creare ordini fittizi. Non è accesso agli ordini altrui: è un rischio di abuso del servizio anonimo. Valutare una verifica anti-bot server-side e monitoraggio. Le letture pubbliche dirette Supabase non passano dal rate limiter Worker e consumano comunque quote del provider.

## Controlli superati

- `npm audit --json`: zero vulnerabilità note, comprese dipendenze di sviluppo. Non esclude vulnerabilità sconosciute o difetti applicativi.
- Nessuna corrispondenza dei tre segreti correnti in 98 file tracciati e 19 file pubblici; `.env.local` non tracciato; nessuna source map pubblica. Non è una scansione completa della storia Git/credenziali storiche.
- Configurazione locale: password almeno 16 caratteri, segreto sessione almeno 32; vecchia password predefinita rifiutata in produzione. Login reale verificato senza mostrare credenziali.
- Cookie reali `Secure`, `HttpOnly`, `SameSite=Lax`; cookie manomessi respinti nei test crittografici. Logout HTTP corretto elimina il cookie del browser, ferma restando SEC-01.
- `/cucina` senza sessione: HTTP 307 al login. Home senza link alla cucina. Pagine sensibili/RPC con `no-store`, `X-Frame-Options: DENY` e CSP anti-embedding.
- RPC con origine esterna: HTTP 403. Middleware CSRF esplicito, conforme alla [documentazione TanStack](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions).
- API cucina senza sessione nega i dati; con sessione valida risponde con le code paginate. Lettura di un ordine non appartenente alla sessione restituisce risultato nullo.
- Privilegi DB effettivi: `anon` non può leggere/modificare ordini, leggere righe ordine, modificare menu, creare oggetti nello schema `public`, né eseguire creazione ordine protetta, avanzamento o restore. Può leggere il menu. Il ruolo server può eseguire restore.
- Corpo effettivo della RPC stato verificato: ID e token di 64 caratteri, confronto hash SHA-256, restituzione dei soli stato/timestamp. Test isolati rifiutano token/ID non corrispondenti.
- Proprietà ordine, transizioni, scorte e idempotenza verificate con le funzioni applicative e migrazioni PostgreSQL isolate; RLS e controlli server non sono stati indeboliti dalle ottimizzazioni.

## Advisor Supabase e limiti

Due avvisi sulla RPC `SECURITY DEFINER` pubblica sono coerenti con l'accesso tramite capability: il controllo del token rimane obbligatorio. Corpo e permessi effettivi sono stati verificati, non presunti sicuri dal solo nome della funzione. [Advisor anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [advisor authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Tre avvisi informativi RLS senza policy su ordini, righe e rate limit corrispondono al blocco intenzionale degli accessi pubblici diretti. Non aggiungere policy permissive per eliminarli. [Dettaglio advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

La skill Supabase ha guidato verifica di ACL e advisor preservando capability e tabelle riservate. Il temporaneo blocco degli strumenti è rientrato e i controlli remoti indicati sono stati completati.

Le correzioni SEC-01/02/03 **non sono implementate**: l'ultima richiesta era un audit. Aggiunti test diagnostici, non modificata l'autenticazione. Le precedenti ottimizzazioni performance sono invece pubblicate, come documentato nel [resoconto dedicato](performance-followup-2026-09-07.md).

Non è un penetration test esaustivo o una certificazione: esclusi compromissione account Cloudflare/Supabase, sicurezza fisica, storia Git completa, attacchi volumetrici e ogni possibile race condition.

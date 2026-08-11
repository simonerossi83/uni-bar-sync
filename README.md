# Barista Buddy

Crea una web application completa per la gestione degli ordini di un piccolo bar universitario.

L’applicazione deve essere realmente utilizzabile da una classe di studenti contemporaneamente, principalmente da smartphone, mentre una dashboard cucina viene mostrata su uno schermo condiviso.

L’obiettivo è simulare il funzionamento reale di un bar durante un momento di forte affluenza.

Ruoli

Ci sono due interfacce principali:

Cliente

Cucina

Non è necessario implementare pagamenti reali.

Flusso cliente

Ogni studente deve poter aprire l’app dal proprio smartphone e:

vedere il menu;

vedere nome, descrizione, prezzo e categoria dei prodotti;

aggiungere prodotti al carrello;

modificare quantità;

rimuovere prodotti;

inserire una nota opzionale;

confermare l’ordine.

Quando viene confermato un ordine, il sistema deve assegnare automaticamente un numero ordine progressivo e facilmente leggibile, ad esempio:

#21
#22
#23

Dopo l’invio, il cliente deve essere portato su una schermata dedicata al proprio ordine.

Questa schermata deve mostrare in modo molto evidente:

numero ordine;

prodotti ordinati;

ora dell’ordine;

stato corrente.

Gli stati principali sono:

Ordine ricevuto

In preparazione

Pronto

Ritirato

Il cliente non deve avere bisogno di ricaricare manualmente la pagina per vedere i cambiamenti di stato.

Quando l’ordine diventa “Pronto”, la schermata deve cambiare chiaramente e mostrare un grande messaggio:

“Il tuo ordine è pronto!”

Deve comparire anche un pulsante grande:

“Ritira ordine”

Quando lo studente preme il pulsante, l’ordine passa allo stato “Ritirato”.

Dashboard cucina

Crea una dashboard cucina pensata per essere mostrata su uno schermo grande o proiettore.

La dashboard deve aggiornarsi automaticamente.

Dividila visivamente in tre sezioni principali:

Nuovi ordini

Mostra gli ordini appena ricevuti.

Per ogni ordine visualizza:

numero;

prodotti;

quantità;

note;

orario.

In preparazione

Mostra gli ordini che la cucina sta preparando.

Pronti

Mostra in modo molto evidente i numeri degli ordini pronti per il ritiro.

Questa sezione deve essere leggibile anche da lontano.

Per esempio:

ORDINI PRONTI

#21
#24
#27
#31

Quando uno studente ritira il proprio ordine dal telefono, l’ordine deve scomparire automaticamente dalla lista “Pronti” e passare tra gli ordini completati.

Ciclo automatico della cucina

La cucina deve lavorare a intervalli regolari.

Implementa un ciclo automatico ogni 10 secondi.

Il funzionamento deve essere il seguente:

gli ordini nuovi vengono ricevuti;

entrano nello stato “In preparazione”;

ogni 10 secondi tutti gli ordini che risultano attualmente “In preparazione” vengono automaticamente impostati come “Pronti”;

i clienti interessati devono vedere il nuovo stato automaticamente sul proprio telefono;

quando il cliente preme “Ritira ordine”, l’ordine diventa “Ritirato”.

Mostra nella dashboard cucina anche un countdown visibile:

“Prossimo batch tra: 8 secondi”

Il countdown deve arrivare a zero e poi ripartire.

Quando parte un nuovo batch, gli ordini interessati devono passare visivamente dalla colonna “In preparazione” alla colonna “Pronti”.

Esperienza in tempo reale

La sincronizzazione tra dispositivi è una parte importante dell’applicazione.

Quando succede qualcosa, tutte le interfacce interessate devono aggiornarsi automaticamente.

In particolare:

quando viene creato un ordine, deve comparire nella dashboard cucina;

quando un ordine entra in preparazione, il cliente deve vedere il nuovo stato;

quando parte il batch cucina, gli ordini devono diventare “Pronti”;

quando un ordine diventa pronto, il cliente deve accorgersene senza refresh;

quando il cliente ritira l’ordine, deve scomparire dalla dashboard dei pronti.

Più utenti devono poter usare l’app contemporaneamente.

Menu

Crea un menu realistico per un bar universitario.

Categorie:

Caffetteria

Bevande

Panini

Snack

Dolci

Inserisci almeno 4 prodotti per categoria.

Esempi:

Espresso

Cappuccino

Caffè americano

Acqua

Coca-Cola

Tè freddo

Panino prosciutto e formaggio

Panino vegetariano

Toast

Cornetto

Muffin

Patatine

Usa prezzi realistici.

Disponibilità prodotti

Ogni prodotto deve poter essere:

disponibile;

esaurito.

Dalla dashboard cucina deve essere possibile rendere rapidamente un prodotto esaurito o nuovamente disponibile.

Quando un prodotto viene impostato come esaurito:

deve essere aggiornato anche sul menu dei clienti;

deve risultare chiaramente non disponibile;

non deve più essere ordinabile.

Questo cambiamento deve essere visibile automaticamente sui dispositivi già collegati.

Dashboard operativa

Mostra anche alcune informazioni sintetiche:

numero totale di ordini ricevuti;

ordini in preparazione;

ordini pronti;

ordini ritirati;

numero di utenti/ordini attivi, se disponibile.

Mantieni questi dati aggiornati automaticamente.

Persistenza

I dati devono essere persistenti.

Ricaricando la pagina:

gli ordini non devono sparire;

gli stati devono essere mantenuti;

i prodotti esauriti devono rimanere esauriti;

il numero progressivo degli ordini non deve ripartire da zero.

Tutte le interfacce devono utilizzare realmente gli stessi dati.

Non simulare la sincronizzazione usando dati separati per ogni client.

Utilizzo simultaneo

Progetta l’app pensando a una situazione in cui circa 30-50 studenti possano:

aprire contemporaneamente il menu;

creare ordini nello stesso momento;

osservare contemporaneamente lo stato del proprio ordine;

ricevere aggiornamenti dalla cucina;

ritirare gli ordini quando diventano pronti.

La dashboard cucina deve poter gestire e visualizzare molti ordini contemporaneamente.

Interfaccia grafica

Usa uno stile moderno da applicazione food ordering.

La UI cliente deve essere:

mobile-first;

semplice;

immediata;

con pochi elementi per schermata;

con lo stato dell’ordine molto evidente.

La dashboard cucina deve essere:

leggibile da lontano;

adatta a uno schermo grande;

con card grandi;

con numeri ordine molto evidenti;

con transizioni visive quando un ordine cambia stato.

Obiettivo

Realizza un MVP completo e realmente funzionante.

Prendi autonomamente le decisioni tecniche necessarie per ottenere una soluzione semplice, moderna e utilizzabile.

Non limitarti a creare una demo statica.

L’applicazione deve realmente permettere a più dispositivi di interagire contemporaneamente con gli stessi ordini e vedere gli aggiornamenti.

Configura tutto ciò che serve per eseguire il progetto localmente.

Al termine:

verifica il flusso completo ordine → preparazione → pronto → ritiro;

verifica che più dispositivi possano essere utilizzati contemporaneamente;

verifica che gli aggiornamenti arrivino automaticamente senza refresh;

verifica che gli ordini persistano dopo il reload;

correggi eventuali errori evidenti;

fornisci istruzioni semplici per avviare l’applicazione.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4ff51a02-9b40-41e1-9ec3-d5cf0dd1c923).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

# Archivio Lavoro

Sito personale per raccogliere:

- **Giornata** (`#/giornata`): appunti veloci per organizzare oggi e domani; alle 21 il bot Telegram
  manda quelli di domani e quelli rimasti aperti (workflow `Giornata` nel repository `lavoro-dati`)
- **Report** di consulenza, lavoro, studio e ricerca (pagina bianca, senza schema) e **liste to-do** (`#/todo`)
- **Idee di business**
- **Progetto cyber** (`#/cyber`): startup come cartelle (documenti, griglie di prezzi e costi con formule,
  liste to-do), report liberi, to-do e conversazioni con imprenditori, tutto nel repository privato `progetto-cyber`
- **Radar Eventi** (`#/eventi` o `/eventi`): eventi professionali letti dal repository privato `radar-eventi`

Funziona da PC e da telefono (si può aggiungere alla schermata Home come un'app).

## Come salva i dati

- Ogni modifica viene salvata **subito** sul dispositivo e, dopo circa 2 secondi, nel file
  `data.json` del repository **privato** `lavoro-dati`.
- All'apertura, al ritorno sulla scheda e ogni 30 secondi il sito scarica le modifiche fatte
  dagli altri dispositivi. Se due dispositivi modificano cose diverse, vengono unite; sullo stesso
  elemento vince la modifica più recente.
- Appunti della giornata e liste to-do dei report vanno in `agenda.json` (stesso repository);
  startup, griglie, documenti e to-do del progetto cyber in `spazio/cyber.json` del repository `progetto-cyber`.
  Sono file separati da `data.json` apposta: una versione vecchia del sito rimasta aperta non li può rovinare.
- Ogni salvataggio è un commit: la cronologia di `lavoro-dati` permette di recuperare qualsiasi
  versione precedente.

Questo repository contiene solo il codice del sito (pubblico, senza dati). Senza token il sito è vuoto.

## Primo collegamento

1. Crea un token *fine-grained* su <https://github.com/settings/personal-access-tokens/new>
   con accesso ai soli repository `lavoro-dati`, `radar-eventi` e `progetto-cyber` e permesso **Contents: Read and write**.
2. Apri il sito dal PC → **Impostazioni** → incolla il token → **Salva e collega**.
3. Sempre in Impostazioni → **Mostra codice QR** → inquadralo con il telefono.

# Archivio Lavoro

Sito personale per raccogliere:

- **Report** di consulenza, lavoro, studio e ricerca
- **Idee di business**
- **Radar Eventi** (`#/eventi` o `/eventi`): eventi professionali letti dal repository privato `radar-eventi`

Funziona da PC e da telefono (si può aggiungere alla schermata Home come un'app).

## Come salva i dati

- Ogni modifica viene salvata **subito** sul dispositivo e, dopo circa 2 secondi, nel file
  `data.json` del repository **privato** `lavoro-dati`.
- All'apertura, al ritorno sulla scheda e ogni 30 secondi il sito scarica le modifiche fatte
  dagli altri dispositivi. Se due dispositivi modificano cose diverse, vengono unite; sullo stesso
  elemento vince la modifica più recente.
- Ogni salvataggio è un commit: la cronologia di `lavoro-dati` permette di recuperare qualsiasi
  versione precedente.

Questo repository contiene solo il codice del sito (pubblico, senza dati). Senza token il sito è vuoto.

## Primo collegamento

1. Crea un token *fine-grained* su <https://github.com/settings/personal-access-tokens/new>
   con accesso ai soli repository `lavoro-dati` e `radar-eventi` e permesso **Contents: Read and write**.
2. Apri il sito dal PC → **Impostazioni** → incolla il token → **Salva e collega**.
3. Sempre in Impostazioni → **Mostra codice QR** → inquadralo con il telefono.

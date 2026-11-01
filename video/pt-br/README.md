# Vídeo de apresentação — pt-BR

Vídeo de ~61 s do ScreenLink feito com [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP
renderizado quadro a quadro). O render final fica em `renders/screenlink-pt-br.mp4`.

## Roteiro

| Tempo | Cena (`compositions/`) | O que acontece |
| --- | --- | --- |
| 0–17,3 s | `chat.html` | Chat dos amigos: "compartilha aí pra eu ver" → *indisponível na sua região* → foto da tela com o celular → bloqueou pra todo mundo |
| 17,3–23,1 s | `build.html` | "Calma." / "Respira." / "Tem outro jeito." / 3-2-1 |
| 23,1–28,9 s | `logo.html` | Drop da música: ScreenLink |
| 28,9–34,7 s | `step-room.html` | 1. Cria uma sala e manda o código |
| 34,7–40,6 s | `step-share.html` | 2. Escolhe o jogo (diálogo real de compartilhamento) |
| 40,6–49,3 s | `watch.html` | 3. Popup "Lucas is sharing" → Watch → boss cai ao vivo |
| 49,3–55,1 s | `slides.html` | Não é só jogo: slides do TCC; recursos |
| 55,1–61,5 s | `outro.html` | Onde baixar |

Os cortes caem na grade da música (82,5 BPM; drop em 23,10 s). Os memes ficam em `index.html`
com high-pass, low-pass, reverb e volume baixo (`data-fx-chain`) e a música abaixa um pouco sob
cada um (`data-automation` em `#music-b`): dá pra mexer em tudo isso no editor do HyperFrames.

## Telas do app a partir de um banco de demonstração

As telas são o app de verdade (`client/ui`, `client/popup`), não mockups desenhados:

```sh
bun mock/seed.ts      # mock/screenlink-demo.sqlite: 15 usuários, 7 salas (schema do server/db.ts)
bun mock/capture.ts   # abre client/ui no Chrome headless com esse banco → assets/screens/*.png
```

- `mock/data.ts` — pessoas e salas; `mock/live.ts` — quem está online/ao vivo em cada cena (o
  servidor guarda isso em memória); `mock/state.ts` — monta o `state` que o `main.js` mandaria
  pra janela.
- O banco abre no servidor real: `DB_FILE=video/pt-br/mock/screenlink-demo.sqlite bun run server`.

## Áudio

```sh
bash mock/audio.sh <powerup.mp3> <pasta-dos-memes>   # corta a música, normaliza memes, gera SFX
```

Créditos em `LICENSES.txt`.

## Preview e render

```sh
npm install
npx hyperframes@0.8.226 preview                                           # editor no navegador
npx hyperframes@0.8.226 render --output renders/screenlink-pt-br.mp4
```

Para a versão em inglês, copie esta pasta para `video/en` e troque os textos das cenas.
